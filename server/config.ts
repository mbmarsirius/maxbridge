import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RuntimeConfig {
  bind: '127.0.0.1';
  port: number;
  defaultModel: string;
  anthropicApiKey: string | null;
  anthropicBaseUrl: string;
  anthropicVersion: string;
  telemetry: 'off';
  localBridgePath: string | null;
  preferLocalBridge: boolean;
  claudeBinary: string;
  bridgeTimeoutMs: number;
}

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_PORT = 7423;
const DEFAULT_BASE = 'https://api.anthropic.com';
const DEFAULT_VERSION = '2023-06-01';
const DEFAULT_CLAUDE_BINARY = 'claude';
const DEFAULT_BRIDGE_TIMEOUT_MS = 180_000;

// Canonical path for the proven local bridge script on this Mac. When the env
// var MAXBRIDGE_BRIDGE_PATH is unset we look here first so the same-machine
// alpha "just works" without extra configuration.
const CANONICAL_BRIDGE_PATHS = [
  '/Users/MACMiniAdmin/.openclaw/workspace/tools/claude-max-bridge.sh',
  join(homedir(), '.openclaw', 'workspace', 'tools', 'claude-max-bridge.sh'),
];

function autodetectBridgePath(): string | null {
  for (const p of CANONICAL_BRIDGE_PATHS) {
    try {
      if (existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const port = (env.MAXBRIDGE_PORT ?? env.LOCALCLAW_PORT) ? Number((env.MAXBRIDGE_PORT ?? env.LOCALCLAW_PORT)) : DEFAULT_PORT;
  const preferLocal = ((env.MAXBRIDGE_PREFER_LOCAL_BRIDGE ?? env.LOCALCLAW_PREFER_LOCAL_BRIDGE) ?? '1').trim() !== '0';
  const timeout = (env.MAXBRIDGE_BRIDGE_TIMEOUT_MS ?? env.LOCALCLAW_BRIDGE_TIMEOUT_MS) ? Number((env.MAXBRIDGE_BRIDGE_TIMEOUT_MS ?? env.LOCALCLAW_BRIDGE_TIMEOUT_MS)) : DEFAULT_BRIDGE_TIMEOUT_MS;
  const bridgePath = (env.MAXBRIDGE_BRIDGE_PATH ?? env.LOCALCLAW_BRIDGE_PATH)?.trim() || autodetectBridgePath();
  return {
    bind: '127.0.0.1',
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
    defaultModel: (env.MAXBRIDGE_MODEL ?? env.LOCALCLAW_MODEL)?.trim() || DEFAULT_MODEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL?.trim() || DEFAULT_BASE,
    anthropicVersion: env.ANTHROPIC_VERSION?.trim() || DEFAULT_VERSION,
    telemetry: 'off',
    localBridgePath: bridgePath,
    preferLocalBridge: preferLocal,
    claudeBinary: (env.MAXBRIDGE_CLAUDE_BINARY ?? env.LOCALCLAW_CLAUDE_BINARY)?.trim() || DEFAULT_CLAUDE_BINARY,
    bridgeTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_BRIDGE_TIMEOUT_MS,
  };
}

export type ProxyMode = 'stub' | 'byo-key' | 'local-oauth';

// Legacy helper kept for transitional callers. Prefer describeProxyMode.
export function describeMode(cfg: RuntimeConfig): 'stub' | 'byo-key' {
  return cfg.anthropicApiKey ? 'byo-key' : 'stub';
}

// The proxy's self-reported mode reflects the configured-backend priority,
// NOT runtime OAuth readiness. Readiness is reported separately in authReality.
// local-oauth is preferred when preferLocalBridge is true (the default on this
// machine), because we verified opus-4-7 end-to-end here via the local CLI.
export function describeProxyMode(cfg: RuntimeConfig): ProxyMode {
  if (cfg.preferLocalBridge) return 'local-oauth';
  if (cfg.anthropicApiKey) return 'byo-key';
  return 'stub';
}
