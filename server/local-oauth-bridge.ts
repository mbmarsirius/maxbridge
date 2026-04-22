// Local OAuth bridge.
//
// Shells into the locally-installed Claude CLI running under the current
// user's OAuth/Max-plan session to answer a proof challenge. This is the
// mode that was actually proven end-to-end on this machine (opus-4-7 via
// `claude -p --model opus`). It is NOT portable — another user on another
// Mac needs their own `claude setup-token` session. See AUTH_REALITY.md.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { RuntimeConfig } from './config.js';
import type {
  LocalBridgeDetails,
  ProofRequest,
  ProofResponse,
} from './types.js';
import { buildProofPrompt } from './upstream.js';

export interface LocalBridgeProbe {
  state: 'ready' | 'cli-missing' | 'cli-not-logged-in' | 'unknown';
  claudeBinaryDetected: boolean;
  claudeVersion: string | null;
  loggedIn: boolean;
  authMethod: string | null;
  provider: string | null;
  bridgePath: string | null;
  note: string;
}

const PROBE_NOTE =
  'Proven path for Maxbridge on THIS Mac: same user, same machine, same keychain. ' +
  'Maxbridge does not try to reuse this session across machines — that would require a ' +
  'sanctioned Anthropic third-party OAuth path, which does not exist.';

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  error: Error | null;
}

function run(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    // CRITICAL: stdin is 'ignore' (/dev/null), NOT 'pipe'.
    //
    // Claude CLI 2.1.90+ reads from stdin even when a prompt is passed via `-p`,
    // and times out after ~3 seconds with "No stdin data received in 3s" if
    // stdin is an open-but-empty pipe (the default for execFile/spawn).
    // Binding stdin to /dev/null makes the child see immediate EOF on read,
    // so the CLI proceeds with just the `-p` prompt and returns normally.
    //
    // This was the ghost bug behind REPORT_STATUS=partial on cold installs:
    // /healthz + /v1/status returned OK (they don't spawn claude), but
    // /v1/messages spawns claude and consistently dropped with the 3s timeout,
    // making OpenClaw fall back to its non-Maxbridge models.
    const child = spawn(file, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let exitSettled = false;
    const MAX_STDOUT = 8 * 1024 * 1024;
    const MAX_STDERR = 1 * 1024 * 1024;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      // Hard-kill 2s later if the child ignored SIGTERM.
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length >= MAX_STDOUT) return;
      const room = MAX_STDOUT - stdout.length;
      const s = chunk.toString('utf8');
      stdout += s.length <= room ? s : s.slice(0, room);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length >= MAX_STDERR) return;
      const room = MAX_STDERR - stderr.length;
      const s = chunk.toString('utf8');
      stderr += s.length <= room ? s : s.slice(0, room);
    });

    const settle = (code: number | null, error: Error | null): void => {
      if (exitSettled) return;
      exitSettled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        code,
        error: timedOut
          ? new Error(`command timed out after ${timeoutMs}ms: ${file} ${args.join(' ')}`)
          : error,
      });
    };

    child.on('close', (code) => settle(code ?? null, null));
    child.on('error', (err) => settle(null, err));
  });
}

function buildChildEnv(cfg: RuntimeConfig): NodeJS.ProcessEnv {
  // Strip billable-API-key routing so the child cannot silently fall back
  // to a BYO key. OAuth token (CLAUDE_CODE_OAUTH_TOKEN) and keychain state
  // are left untouched so the CLI uses the logged-in subscription session.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  delete env.CLAUDE_CODE_SIMPLE;

  if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
    const home = env.HOME;
    const candidates = home
      ? ['.zshrc', '.zprofile', '.bash_profile'].map((name) => `${home}/${name}`)
      : [];
    for (const file of candidates) {
      try {
        if (!existsSync(file)) continue;
        const text = readFileSync(file, 'utf8');
        const match = text.match(/CLAUDE_CODE_OAUTH_TOKEN=['"]?([^'"\n]+)['"]?/);
        if (match?.[1]) {
          env.CLAUDE_CODE_OAUTH_TOKEN = match[1];
          break;
        }
      } catch {
        // ignore startup file parse failures
      }
    }
  }

  void cfg;
  return env;
}

function parseAuthStatus(stdout: string): {
  loggedIn: boolean;
  authMethod: string | null;
  provider: string | null;
} {
  try {
    const obj = JSON.parse(stdout) as Record<string, unknown>;
    return {
      loggedIn: obj.loggedIn === true,
      authMethod: typeof obj.authMethod === 'string' ? obj.authMethod : null,
      provider: typeof obj.apiProvider === 'string' ? (obj.apiProvider as string) : null,
    };
  } catch {
    const loggedIn = /"loggedIn"\s*:\s*true/i.test(stdout);
    const methodMatch = stdout.match(/"authMethod"\s*:\s*"([^"]+)"/);
    const providerMatch = stdout.match(/"apiProvider"\s*:\s*"([^"]+)"/);
    return {
      loggedIn,
      authMethod: methodMatch?.[1] ?? null,
      provider: providerMatch?.[1] ?? null,
    };
  }
}

// Probe cache — probing the CLI spawns two child processes (~5-8 seconds total).
// Gateway's retry pattern hammers /v1/messages with up to 4 parallel requests,
// which means 8 concurrent CLI spawns just for validation, racing the keychain.
// We cache the last successful probe for 60 seconds so repeated calls are O(1).
let probeCache: { at: number; result: LocalBridgeProbe } | null = null;
const PROBE_CACHE_TTL_MS = 60_000;

// Serialize only the PROBE invocations (cheap, short). Do NOT serialize the
// main /v1/messages CLI spawn — when Opus uses a sub-wrapper like
// `sheep-agent-call patron` that itself routes back through Maxbridge (if
// patron ever pointed at maxbridge), a strict mutex would deadlock the parent
// request behind its own child. The probe cache already prevents probe stampede
// for the 60s TTL after first success.
let probeChain: Promise<unknown> = Promise.resolve();
function serializeCli<T>(fn: () => Promise<T>): Promise<T> {
  const next = probeChain.then(fn, fn);
  probeChain = next.catch(() => undefined);
  return next;
}

export async function probeLocalBridge(
  cfg: RuntimeConfig,
): Promise<LocalBridgeProbe> {
  if (probeCache && Date.now() - probeCache.at < PROBE_CACHE_TTL_MS && probeCache.result.state === 'ready') {
    return probeCache.result;
  }
  const env = buildChildEnv(cfg);
  const bridgePath = cfg.localBridgePath && existsSync(cfg.localBridgePath)
    ? cfg.localBridgePath
    : null;

  // 1. Does the `claude` binary exist and run?
  const versionRun = await serializeCli(() => run(cfg.claudeBinary, ['--version'], env, 3000));
  const claudeBinaryDetected = versionRun.code === 0;
  const claudeVersion = claudeBinaryDetected
    ? versionRun.stdout.trim().split('\n')[0] || null
    : null;

  if (!claudeBinaryDetected) {
    return {
      state: 'cli-missing',
      claudeBinaryDetected: false,
      claudeVersion: null,
      loggedIn: false,
      authMethod: null,
      provider: null,
      bridgePath,
      note: `Claude CLI not found (\`${cfg.claudeBinary}\`). Install it, then run \`claude setup-token\`. ${PROBE_NOTE}`,
    };
  }

  // 2. FAST PATH — if CLAUDE_CODE_OAUTH_TOKEN is present in env, trust it.
  //
  // Claude CLI 2.1.90+ dropped the `--json` flag on `claude auth status`,
  // so the legacy auth-status probe below can no longer reliably detect
  // OAuth state. When the installer has captured the long-lived token from
  // `claude setup-token` output and injected it into the daemon's launchd
  // plist (or when the user exported it in their shell RCs the bridge
  // scans), the most honest signal is "is there a plausible oauth token
  // in env?". If yes, treat the bridge as ready without calling auth-status.
  const envToken = env.CLAUDE_CODE_OAUTH_TOKEN ?? '';
  if (envToken.startsWith('sk-ant-oat01-') && envToken.length >= 40) {
    const readyProbe: LocalBridgeProbe = {
      state: 'ready',
      claudeBinaryDetected: true,
      claudeVersion,
      loggedIn: true,
      authMethod: 'oauth_token',
      provider: 'firstParty',
      bridgePath,
      note: `OAuth token detected in environment. ${PROBE_NOTE}`,
    };
    probeCache = { at: Date.now(), result: readyProbe };
    return readyProbe;
  }

  // 3. Legacy path — try `claude auth status --json` for older CLIs.
  // This path returns cli-not-logged-in on claude 2.1.90+ where --json is
  // rejected. That's a correct failure signal on a Mac with no captured
  // token: the installer should run claude setup-token + token capture.
  const authRun = await serializeCli(() => run(cfg.claudeBinary, ['auth', 'status', '--json'], env, 5000));
  const { loggedIn, authMethod, provider } = parseAuthStatus(authRun.stdout || authRun.stderr);

  if (!loggedIn || authMethod !== 'oauth_token') {
    return {
      state: 'cli-not-logged-in',
      claudeBinaryDetected: true,
      claudeVersion,
      loggedIn: false,
      authMethod,
      provider,
      bridgePath,
      note: `Claude CLI is installed but no OAuth token detected. Run \`claude setup-token\` on this Mac, then re-run the Maxbridge installer so it can capture and persist the token for the daemon. ${PROBE_NOTE}`,
    };
  }

  const readyProbe: LocalBridgeProbe = {
    state: 'ready',
    claudeBinaryDetected: true,
    claudeVersion,
    loggedIn: true,
    authMethod,
    provider,
    bridgePath,
    note: `Local Claude CLI OAuth bridge is ready on this machine. ${PROBE_NOTE}`,
  };
  probeCache = { at: Date.now(), result: readyProbe };
  return readyProbe;
}

function resolveBridgeInvocation(
  cfg: RuntimeConfig,
  requestedModel: string,
): {
  file: string;
  baseArgs: string[];
  invokedWith: 'claude-cli' | 'bridge-script';
  bridgePath: string;
} {
  if (cfg.localBridgePath && existsSync(cfg.localBridgePath)) {
    try {
      const s = statSync(cfg.localBridgePath);
      if (s.isFile()) {
        return {
          file: cfg.localBridgePath,
          baseArgs: [],
          invokedWith: 'bridge-script',
          bridgePath: cfg.localBridgePath,
        };
      }
    } catch {
      // fall through to direct CLI
    }
  }
  return {
    file: cfg.claudeBinary,
    baseArgs: [
      '-p',
      '--model',
      requestedModel,
      '--output-format',
      'json',
      '--no-session-persistence',
    ],
    invokedWith: 'claude-cli',
    bridgePath: cfg.claudeBinary,
  };
}

interface ClaudeCliJson {
  // Note: `claude -p --output-format json` does NOT return a single top-level
  // `model` field. The actual model mix lives in `modelUsage` as a keyed
  // object, with each key being an Anthropic model id. We prefer that shape
  // but keep top-level `model` as a defensive fallback for future CLI versions.
  model?: string;
  modelUsage?: Record<string, unknown>;
  result?: string;
  role?: string;
  type?: string;
  session_id?: string;
  usage?: Record<string, unknown>;
  stop_reason?: string;
  total_cost_usd?: number;
  is_error?: boolean;
}

export async function runLocalOauthProof(
  cfg: RuntimeConfig,
  req: ProofRequest,
): Promise<ProofResponse> {
  const requestedModel = req.model?.trim() || cfg.defaultModel;
  const sentAt = new Date().toISOString();
  const prompt = buildProofPrompt(req.challengeId);
  const env = buildChildEnv(cfg);

  const probe = await probeLocalBridge(cfg);
  const bridgePath = probe.bridgePath ?? cfg.claudeBinary;

  const baseDetails: LocalBridgeDetails = {
    bridgePath,
    claudeVersion: probe.claudeVersion,
    authMethod: probe.authMethod,
    provider: probe.provider,
    exitCode: null,
    stderr: '',
    invokedWith: 'claude-cli',
    sameMachineOnly: true,
    portable: false,
  };

  const failure = (error: string, stderr = '', exitCode: number | null = null): ProofResponse => ({
    mode: 'local-oauth',
    endpoint: `http://${cfg.bind}:${cfg.port}`,
    requestedModel,
    respondedModel: null,
    challengeId: req.challengeId,
    sentAt,
    receivedAt: new Date().toISOString(),
    requestHeaders: {
      'x-maxbridge-mode': 'local-oauth',
      'x-maxbridge-bridge-path': bridgePath,
    },
    responseHeaders: {
      'x-maxbridge-mode': 'local-oauth',
      'x-maxbridge-same-machine': 'true',
      'x-maxbridge-portable': 'false',
    },
    rawBody: stderr,
    streamedText: '',
    sseChunks: [],
    parsedJson: null,
    upstreamStatus: exitCode,
    note:
      'This proof attempted to use the local Claude CLI OAuth bridge on this machine. ' +
      'It is proven for same-user same-machine only and is not portable to other Macs.',
    error,
    bridge: { ...baseDetails, exitCode, stderr },
  });

  if (probe.state !== 'ready') {
    return failure(
      probe.state === 'cli-missing'
        ? 'Local Claude CLI is not installed.'
        : probe.state === 'cli-not-logged-in'
          ? 'Local Claude CLI is not logged in. Run `claude setup-token` on this Mac.'
          : 'Local Claude CLI bridge is not ready.',
    );
  }

  const { file, baseArgs, invokedWith } = resolveBridgeInvocation(cfg, requestedModel);
  const args = invokedWith === 'bridge-script' ? [prompt] : [...baseArgs, prompt];

  // If invoked as bridge-script, ask the script to emit JSON so we can
  // parse model/result the same way as the direct CLI path.
  const childEnv = invokedWith === 'bridge-script'
    ? { ...env, CLAUDE_BRIDGE_FORMAT: 'json', CLAUDE_BRIDGE_MODEL: requestedModel }
    : env;

  const result = await run(file, args, childEnv, cfg.bridgeTimeoutMs);
  const receivedAt = new Date().toISOString();

  if (result.error && result.code !== 0) {
    return failure(
      `Bridge invocation failed (exit ${result.code ?? 'n/a'}): ${result.error.message}`,
      result.stderr,
      result.code,
    );
  }

  let parsed: ClaudeCliJson | null = null;
  try {
    parsed = JSON.parse(result.stdout) as ClaudeCliJson;
  } catch {
    parsed = null;
  }

  // Prefer the requested model if it is among the models the CLI actually used
  // for this turn; otherwise report the comma-joined set so the user sees the
  // honest mix (router + primary may be distinct models).
  let respondedModel: string | null = null;
  if (parsed?.model) {
    respondedModel = parsed.model;
  } else if (parsed?.modelUsage) {
    const keys = Object.keys(parsed.modelUsage);
    if (keys.includes(requestedModel)) {
      respondedModel = requestedModel;
    } else if (keys.length > 0) {
      respondedModel = keys.join(',');
    }
  }
  const streamedText = parsed?.result ?? result.stdout;

  return {
    mode: 'local-oauth',
    endpoint: `http://${cfg.bind}:${cfg.port}`,
    requestedModel,
    respondedModel,
    challengeId: req.challengeId,
    sentAt,
    receivedAt,
    requestHeaders: {
      'x-maxbridge-mode': 'local-oauth',
      'x-maxbridge-invoked-with': invokedWith,
      'x-maxbridge-bridge-path': bridgePath,
    },
    responseHeaders: {
      'x-maxbridge-mode': 'local-oauth',
      'x-maxbridge-same-machine': 'true',
      'x-maxbridge-portable': 'false',
      'x-maxbridge-auth-method': probe.authMethod ?? 'unknown',
      'x-maxbridge-provider': probe.provider ?? 'unknown',
    },
    rawBody: result.stdout,
    streamedText,
    sseChunks: [],
    parsedJson: parsed,
    upstreamStatus: result.code,
    note:
      'This proof used the local Claude CLI OAuth subscription bridge on THIS Mac. ' +
      'No Anthropic API key was used. The OAuth/Max-plan session is local to this ' +
      "user's keychain and shell; this path is NOT portable to another machine.",
    error: null,
    bridge: {
      ...baseDetails,
      exitCode: result.code,
      stderr: result.stderr,
      invokedWith,
    },
  };
}

// ---------------------------------------------------------------------------
// /v1/messages via the local CLI (best-effort, non-streaming, simple shape)
// ---------------------------------------------------------------------------
//
// This is the smallest honest step beyond "only /v1/proof is bridged." It
// accepts Anthropic Messages bodies that look like a plain chat turn — one or
// more `{role:'user', content:<string|simple text blocks>}` entries — and
// routes them through the local Claude CLI OAuth session. Anything more
// sophisticated (assistant turns, tool_use, images, streaming) returns a
// decline so the caller can fall back to the BYO-key passthrough rather than
// get silently wrong behaviour.

export interface AnthropicMessagesBody {
  model?: string;
  system?: string | Array<{ type: string; text?: string }>;
  messages?: Array<{
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  }>;
  stream?: boolean;
  max_tokens?: number;
}

export interface LocalMessagesResult {
  ok: true;
  status: 200;
  body: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content: Array<{ type: 'text'; text: string }>;
    stop_reason: 'end_turn';
    stop_sequence: null;
    usage: { input_tokens: number; output_tokens: number };
  };
  headers: Record<string, string>;
}

export interface LocalMessagesDecline {
  ok: false;
  reason: string;
  status?: number;
}

function flattenContent(
  content: string | Array<{ type?: string; text?: string; name?: string; input?: unknown; content?: unknown; tool_use_id?: string; is_error?: boolean }> | undefined,
): { ok: true; text: string } | { ok: false; reason: string } {
  if (typeof content === 'string') return { ok: true, text: content };
  if (!Array.isArray(content)) return { ok: true, text: '' };
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    // Text block — the primary case.
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
      continue;
    }
    // Assistant tool_use — render as a note so multi-turn context is preserved.
    if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : 'tool';
      let inputStr = '';
      try { inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}); } catch { /* ignore */ }
      if (inputStr.length > 500) inputStr = inputStr.slice(0, 497) + '…';
      parts.push(`[prior tool call: ${name}(${inputStr})]`);
      continue;
    }
    // User tool_result — extract text content if present.
    if (block.type === 'tool_result') {
      let resultText = '';
      if (typeof block.content === 'string') {
        resultText = block.content;
      } else if (Array.isArray(block.content)) {
        resultText = (block.content as any[])
          .map((c) => (c && typeof c === 'object' && typeof c.text === 'string' ? c.text : ''))
          .filter(Boolean)
          .join('\n');
      }
      if (resultText.length > 2000) resultText = resultText.slice(0, 1997) + '…';
      const marker = block.is_error ? 'prior tool error' : 'prior tool result';
      if (resultText) parts.push(`[${marker}: ${resultText}]`);
      continue;
    }
    // Images / documents / unknown — drop silently (Opus CLI can't consume them this way).
  }
  return { ok: true, text: parts.join('\n') };
}

function flattenSystem(
  system: AnthropicMessagesBody['system'],
): { ok: true; text: string | null } | { ok: false; reason: string } {
  if (system === undefined || system === null) return { ok: true, text: null };
  if (typeof system === 'string') return { ok: true, text: system };
  if (Array.isArray(system)) {
    const parts: string[] = [];
    for (const b of system) {
      if (b && b.type === 'text' && typeof b.text === 'string') {
        parts.push(b.text);
        continue;
      }
      return { ok: false, reason: 'unsupported system block shape' };
    }
    return { ok: true, text: parts.join('\n') };
  }
  return { ok: false, reason: 'unsupported system field shape' };
}

export function buildLocalPromptFromMessages(
  body: AnthropicMessagesBody,
): { ok: true; prompt: string; userTurns: number } | { ok: false; reason: string } {
  // NOTE: stream:true is accepted here. The CLI runs non-streaming internally;
  // the proxy layer converts the completed message into an Anthropic SSE stream
  // for the caller (see passthroughMessages in proxy.ts).
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, reason: 'messages[] is required and must be non-empty' };
  }
  const sys = flattenSystem(body.system);
  if (!sys.ok) return { ok: false, reason: sys.reason };

  const lines: string[] = [];
  if (sys.text && sys.text.trim().length > 0) {
    lines.push(`[system]\n${sys.text.trim()}`);
  }
  let userTurns = 0;
  for (const m of messages) {
    const role = typeof m.role === 'string' ? m.role.toLowerCase() : '';
    if (role !== 'user' && role !== 'assistant') {
      return { ok: false, reason: `unsupported role: ${m.role ?? 'unknown'}` };
    }
    const flat = flattenContent(m.content);
    if (!flat.ok) return { ok: false, reason: flat.reason };
    if (role === 'user') userTurns += 1;
    lines.push(`[${role}]\n${flat.text.trim()}`);
  }
  if (userTurns === 0) {
    return { ok: false, reason: 'no user turn found in messages[]' };
  }
  // Pin the assistant's next turn.
  lines.push('[assistant]');
  return { ok: true, prompt: lines.join('\n\n'), userTurns };
}

export async function runLocalOauthMessages(
  cfg: RuntimeConfig,
  body: AnthropicMessagesBody,
): Promise<LocalMessagesResult | LocalMessagesDecline> {
  const probe = await probeLocalBridge(cfg);
  if (probe.state !== 'ready') {
    return {
      ok: false,
      reason:
        probe.state === 'cli-missing'
          ? 'Local Claude CLI is not installed on this Mac.'
          : probe.state === 'cli-not-logged-in'
            ? 'Local Claude CLI is not logged in. Run `claude setup-token` on this Mac.'
            : 'Local Claude CLI bridge is not ready.',
    };
  }

  const prepared = buildLocalPromptFromMessages(body);
  if (!prepared.ok) return { ok: false, reason: prepared.reason };

  const requestedModel = (typeof body.model === 'string' && body.model.trim())
    ? body.model.trim()
    : cfg.defaultModel;

  // OpenClaw-bridge mode: invoke the CLI with FULL tool access and stream-json
  // output so Opus 4.7 runs its native agent loop (Read/Write/Edit/Bash/Grep/
  // Glob/WebFetch/WebSearch) inside the user's OAuth session. We capture the
  // CLI's tool_use/tool_result events and fold them into the assistant message
  // as a narrated trace so OpenClaw (and the Telegram UI) see what Opus did.
  const env = buildChildEnv(cfg);
  // Working directory for the CLI (where Read/Write/Bash tools resolve relative
  // paths). Defaults to the user's home; overridable via env for power users.
  const workspaceDir = env.MAXBRIDGE_AGENT_CWD || env.HOME || process.cwd();
  // Optional extra directory whose binaries are appended to the CLI's PATH —
  // lets advanced users expose their own shell wrappers (e.g. ERP/SQL helpers)
  // without modifying Maxbridge.
  const userToolsDir = env.MAXBRIDGE_TOOLS_DIR || '';
  const allowedTools = env.MAXBRIDGE_TOOLS || 'Read,Write,Edit,Bash,Grep,Glob,WebFetch,WebSearch';
  // Identity injection — tells the CLI-hosted agent loop what model slug it is
  // serving, so its self-identity answers stay consistent with how the calling
  // app sees it. The default is intentionally generic; integrating apps can
  // override via MAXBRIDGE_IDENTITY_PROMPT to inject app-specific context.
  const identityPrompt = env.MAXBRIDGE_IDENTITY_PROMPT
    || [
      'You are Claude Opus 4.7 served through Maxbridge — a local-only OAuth bridge running on the user\'s own Mac.',
      'Active model slug as the calling application sees it: maxbridge/claude-opus-4-7. Authentication is the user\'s own Claude Max subscription via the locally-installed Claude CLI (no API key, no remote service in the loop).',
      'When you use Bash/Read/Write/Edit/Grep/Glob/WebFetch/WebSearch tools, the bridge folds tool_use and tool_result events into a narrated trace prefixed with 🔧 so the calling UI can show what you did. Be concise.',
      'If the calling app has supplied a system prompt of its own, defer to it for persona and behavior — this identity block is a runtime fact about the transport, not a persona override.',
    ].join('\n');
  const cliArgs = [
    '-p',
    '--model', requestedModel,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--tools', allowedTools,
    '--add-dir', workspaceDir,
    '--append-system-prompt', identityPrompt,
    '--no-session-persistence',
    prepared.prompt,
  ];
  const bridgePath = cfg.claudeBinary;
  const invokedWith: 'claude-cli' = 'claude-cli';

  // IMPORTANT: do NOT serialize the /v1/messages CLI spawn. Opus may invoke
  // nested agents via sheep-* wrappers, which can queue further /v1/messages
  // requests — strict serialization would deadlock parent behind child.
  // Concurrent CLI spawns are fine here; each call uses its own session state.
  const childPath = userToolsDir
    ? `${userToolsDir}:${env.PATH || ''}`
    : (env.PATH || '');
  const result = await run(cfg.claudeBinary, cliArgs, { ...env, PWD: workspaceDir, PATH: childPath }, cfg.bridgeTimeoutMs);
  if (result.code !== 0 && result.code !== null) {
    return {
      ok: false,
      status: 502,
      reason: `Local bridge invocation failed (exit ${result.code}): ${result.error?.message ?? 'unknown'}${result.stderr ? `\n${result.stderr.slice(0, 800)}` : ''}`,
    };
  }

  // Parse stream-json JSONL events.
  const narration: string[] = [];
  let finalResult = '';
  let sessionId = '';
  let respondedModel = requestedModel;
  let inputTokens = 0;
  let outputTokens = 0;
  let numTurns = 0;

  const lines = result.stdout.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type === 'system' && evt.subtype === 'init') {
      sessionId = typeof evt.session_id === 'string' ? evt.session_id : sessionId;
      if (typeof evt.model === 'string') respondedModel = evt.model;
    } else if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
      for (const block of evt.message.content) {
        if (block && block.type === 'tool_use') {
          const name = typeof block.name === 'string' ? block.name : 'tool';
          let argPreview = '';
          try {
            const input = block.input ?? {};
            const firstKey = Object.keys(input)[0];
            const firstVal = firstKey ? String(input[firstKey]) : '';
            argPreview = firstVal ? `: ${firstVal}` : '';
            if (argPreview.length > 140) argPreview = argPreview.slice(0, 137) + '…';
          } catch { /* ignore */ }
          narration.push(`🔧 ${name}${argPreview}`);
        }
        // Intermediate text blocks (e.g. narration between tool calls) are skipped
        // because the final `result` event already contains the authoritative answer.
      }
    } else if (evt.type === 'user' && evt.message && Array.isArray(evt.message.content)) {
      for (const block of evt.message.content) {
        if (block && block.type === 'tool_result') {
          const raw = typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join(' ')
              : '';
          const cleaned = raw.replace(/\s+/g, ' ').trim();
          const preview = cleaned.length > 160 ? cleaned.slice(0, 157) + '…' : cleaned;
          const marker = block.is_error ? '   ⚠' : '   →';
          if (preview) narration.push(`${marker} ${preview}`);
        }
      }
    } else if (evt.type === 'result') {
      if (typeof evt.result === 'string') finalResult = evt.result;
      if (typeof evt.num_turns === 'number') numTurns = evt.num_turns;
      const usage = evt.usage ?? {};
      if (typeof usage.input_tokens === 'number') inputTokens = usage.input_tokens;
      if (typeof usage.output_tokens === 'number') outputTokens = usage.output_tokens;
      if (evt.modelUsage && typeof evt.modelUsage === 'object') {
        const keys = Object.keys(evt.modelUsage);
        const opusKey = keys.find((k) => k.includes('opus'));
        if (opusKey) respondedModel = opusKey;
      }
    }
  }

  if (!finalResult && lines.length === 0) {
    return {
      ok: false,
      status: 502,
      reason: `Local CLI returned no stream-json events. stderr: ${result.stderr.slice(0, 800)}`,
    };
  }

  const hasTools = narration.length > 0;
  const combinedText = hasTools
    ? `${narration.join('\n')}\n\n${finalResult || '(no final text)'}`
    : (finalResult || result.stdout.trim());

  return {
    ok: true,
    status: 200,
    body: {
      id: `msg_localclaw_${sessionId || Date.now().toString(36)}`,
      type: 'message',
      role: 'assistant',
      model: respondedModel,
      content: [{ type: 'text', text: combinedText }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-maxbridge-mode': 'local-oauth',
      'x-maxbridge-bridge-path': bridgePath,
      'x-maxbridge-invoked-with': invokedWith,
      'x-maxbridge-same-machine': 'true',
      'x-maxbridge-portable': 'false',
      'x-maxbridge-auth-method': probe.authMethod ?? 'unknown',
      'x-maxbridge-provider': probe.provider ?? 'unknown',
      'x-maxbridge-tool-turns': String(numTurns),
      'x-maxbridge-session-id': sessionId,
    },
  };
}

export const localBridgeTodo = [
  'Stream tokens incrementally instead of buffering full CLI JSON output (needed before /v1/messages supports stream:true).',
  'Capture and surface the CLI session id so users can audit runs against local Claude CLI logs.',
  'Add an opt-in per-request Keychain session inspection so onboarding can show auth-method provenance.',
  'Support tool_use / multi-content shapes on /v1/messages via the CLI — currently declined, falls back to BYO-key.',
] as const;
