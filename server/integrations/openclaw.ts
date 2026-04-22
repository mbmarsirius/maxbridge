// Integration: OpenClaw
//
// First-class target audience for Maxbridge — Anthropic blocked OpenClaw users
// from using Claude subscriptions on 2026-04-04. Maxbridge provides a local
// bridge that lets those users keep running OpenClaw against their Max plan
// via the same-machine Claude CLI OAuth path (not API key).
//
// This module:
//   - Detects whether OpenClaw is installed on the user's Mac
//   - Reads the user's openclaw.json config to find existing providers/agents
//   - Reports whether the Maxbridge provider is already wired up
//   - Installs the Maxbridge provider into openclaw.json (idempotent, with
//     timestamped backup) when the user clicks "Connect" in the wizard
//
// All filesystem operations are scoped to ~/.openclaw to keep the integration
// safe — we never touch anything outside the user's OpenClaw config.

import { existsSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const OPENCLAW_CONFIG = join(OPENCLAW_DIR, 'openclaw.json');
const MAXBRIDGE_PROVIDER_KEY = 'maxbridge';
const MAXBRIDGE_DEFAULT_PORT = 7423;

export interface OpenClawDetection {
  installed: boolean;
  configPath: string | null;
  configExists: boolean;
  configValid: boolean;
  providers: string[];
  hasMaxbridgeProvider: boolean;
  hasMaxbridgeAsPrimary: boolean;
  agents: Array<{ id: string; name?: string; primary?: string; usesMaxbridge: boolean }>;
  detectedAt: string;
  reason?: string;
}

export interface InstallResult {
  ok: boolean;
  changed: boolean;
  backupPath?: string;
  steps: string[];
  reason?: string;
}

interface OpenClawConfig {
  models?: { providers?: Record<string, unknown> };
  agents?: { defaults?: { model?: { primary?: string } }; list?: Array<Record<string, unknown>> };
  [k: string]: unknown;
}

function readConfig(): { ok: true; cfg: OpenClawConfig } | { ok: false; reason: string } {
  if (!existsSync(OPENCLAW_CONFIG)) return { ok: false, reason: 'openclaw.json missing' };
  try {
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf8');
    const cfg = JSON.parse(raw) as OpenClawConfig;
    return { ok: true, cfg };
  } catch (err) {
    return { ok: false, reason: `parse error: ${(err as Error).message}` };
  }
}

export function detectOpenClaw(): OpenClawDetection {
  const detectedAt = new Date().toISOString();

  if (!existsSync(OPENCLAW_DIR) || !statSync(OPENCLAW_DIR).isDirectory()) {
    return {
      installed: false,
      configPath: null,
      configExists: false,
      configValid: false,
      providers: [],
      hasMaxbridgeProvider: false,
      hasMaxbridgeAsPrimary: false,
      agents: [],
      detectedAt,
      reason: '~/.openclaw directory not found',
    };
  }

  if (!existsSync(OPENCLAW_CONFIG)) {
    return {
      installed: true,
      configPath: OPENCLAW_CONFIG,
      configExists: false,
      configValid: false,
      providers: [],
      hasMaxbridgeProvider: false,
      hasMaxbridgeAsPrimary: false,
      agents: [],
      detectedAt,
      reason: 'openclaw.json not yet created — run `openclaw setup` first',
    };
  }

  const parsed = readConfig();
  if (!parsed.ok) {
    return {
      installed: true,
      configPath: OPENCLAW_CONFIG,
      configExists: true,
      configValid: false,
      providers: [],
      hasMaxbridgeProvider: false,
      hasMaxbridgeAsPrimary: false,
      agents: [],
      detectedAt,
      reason: parsed.reason,
    };
  }

  const cfg = parsed.cfg;
  const providers = Object.keys(cfg.models?.providers ?? {});
  const hasMaxbridgeProvider = providers.includes(MAXBRIDGE_PROVIDER_KEY);
  const defaultPrimary = String(cfg.agents?.defaults?.model?.primary ?? '');
  const agentList = Array.isArray(cfg.agents?.list) ? cfg.agents!.list! : [];
  const agents = agentList.map((a) => {
    const id = String(a.id ?? 'unknown');
    const name = typeof a.name === 'string' ? a.name : undefined;
    const primary = String((a as { model?: { primary?: string } }).model?.primary ?? defaultPrimary);
    return { id, name, primary, usesMaxbridge: primary.startsWith(`${MAXBRIDGE_PROVIDER_KEY}/`) };
  });

  return {
    installed: true,
    configPath: OPENCLAW_CONFIG,
    configExists: true,
    configValid: true,
    providers,
    hasMaxbridgeProvider,
    hasMaxbridgeAsPrimary: defaultPrimary.startsWith(`${MAXBRIDGE_PROVIDER_KEY}/`),
    agents,
    detectedAt,
  };
}

export interface InstallOptions {
  /** Port the Maxbridge proxy is listening on (defaults to 7423). */
  port?: number;
  /** If true, also set the Maxbridge provider as agents.defaults.model.primary. */
  setAsDefault?: boolean;
  /** If non-empty, set Maxbridge as primary for these specific agent ids. */
  setForAgents?: string[];
  /** Models to register on the Maxbridge provider. Defaults to claude-opus-4-7 only. */
  models?: Array<{ id: string; name?: string }>;
}

export function installOpenClawProvider(opts: InstallOptions = {}): InstallResult {
  const steps: string[] = [];
  const port = opts.port ?? MAXBRIDGE_DEFAULT_PORT;
  const models = opts.models ?? [{ id: 'claude-opus-4-7', name: 'Claude Opus 4.7 (via Maxbridge OAuth)' }];

  const parsed = readConfig();
  if (!parsed.ok) {
    return { ok: false, changed: false, steps, reason: parsed.reason };
  }
  const cfg = parsed.cfg;

  // Backup once.
  const backupPath = `${OPENCLAW_CONFIG}.bak-maxbridge-${Date.now()}`;
  try {
    copyFileSync(OPENCLAW_CONFIG, backupPath);
    steps.push(`backup: ${backupPath}`);
  } catch (err) {
    return { ok: false, changed: false, steps, reason: `backup failed: ${(err as Error).message}` };
  }

  cfg.models = cfg.models ?? {};
  cfg.models.providers = cfg.models.providers ?? {};
  const providers = cfg.models.providers as Record<string, unknown>;
  const existing = providers[MAXBRIDGE_PROVIDER_KEY] as Record<string, unknown> | undefined;
  const desiredProvider = {
    baseUrl: `http://127.0.0.1:${port}`,
    api: 'anthropic-messages',
    models: models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextWindow: 200000,
      reasoning: false,
      maxTokens: 8000,
    })),
  };
  if (JSON.stringify(existing) !== JSON.stringify(desiredProvider)) {
    providers[MAXBRIDGE_PROVIDER_KEY] = desiredProvider;
    steps.push(existing ? 'updated providers.maxbridge' : 'added providers.maxbridge');
  } else {
    steps.push('providers.maxbridge already up-to-date');
  }

  const primarySlug = `${MAXBRIDGE_PROVIDER_KEY}/${models[0]!.id}`;

  if (opts.setAsDefault) {
    cfg.agents = cfg.agents ?? {};
    const defaults = (cfg.agents as { defaults?: { model?: { primary?: string; fallbacks?: string[] } } }).defaults
      ?? ((cfg.agents as { defaults?: unknown }).defaults = {} as { model?: { primary?: string; fallbacks?: string[] } }, (cfg.agents as { defaults: { model?: { primary?: string; fallbacks?: string[] } } }).defaults);
    defaults.model = defaults.model ?? {};
    if (defaults.model.primary !== primarySlug) {
      const previousPrimary = defaults.model.primary;
      defaults.model.primary = primarySlug;
      const fallbacks = Array.isArray(defaults.model.fallbacks) ? defaults.model.fallbacks : [];
      if (previousPrimary && previousPrimary !== primarySlug && !fallbacks.includes(previousPrimary)) {
        defaults.model.fallbacks = [previousPrimary, ...fallbacks];
        steps.push(`moved previous default primary to fallback: ${previousPrimary}`);
      }
      steps.push(`set agents.defaults.model.primary = ${primarySlug}`);
    } else {
      steps.push(`agents.defaults.model.primary already ${primarySlug}`);
    }
  }

  if (opts.setForAgents && opts.setForAgents.length > 0) {
    const agentList = Array.isArray(cfg.agents?.list) ? cfg.agents!.list! : [];
    for (const agentId of opts.setForAgents) {
      const a = agentList.find((x) => x.id === agentId) as
        | { id: string; model?: { primary?: string; fallbacks?: string[] } }
        | undefined;
      if (!a) {
        steps.push(`agent "${agentId}" not found — skipped`);
        continue;
      }
      a.model = a.model ?? {};
      if (a.model.primary !== primarySlug) {
        const prev = a.model.primary;
        a.model.primary = primarySlug;
        const fb = Array.isArray(a.model.fallbacks) ? a.model.fallbacks : [];
        if (prev && prev !== primarySlug && !fb.includes(prev)) a.model.fallbacks = [prev, ...fb];
        steps.push(`agent "${agentId}".model.primary → ${primarySlug}`);
      } else {
        steps.push(`agent "${agentId}" already on Maxbridge`);
      }
    }
  }

  try {
    writeFileSync(OPENCLAW_CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    steps.push('wrote openclaw.json');
  } catch (err) {
    return { ok: false, changed: false, backupPath, steps, reason: `write failed: ${(err as Error).message}` };
  }

  return { ok: true, changed: true, backupPath, steps };
}
