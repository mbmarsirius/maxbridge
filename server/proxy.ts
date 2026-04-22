import { IncomingMessage, ServerResponse, createServer, type Server } from 'node:http';
import { URL } from 'node:url';
import { describeProxyMode, loadRuntimeConfig, type RuntimeConfig } from './config.js';
import { makeStubProof, runLiveProof } from './upstream.js';
import {
  probeLocalBridge,
  runLocalOauthProof,
  runLocalOauthMessages,
  type AnthropicMessagesBody,
} from './local-oauth-bridge.js';
import { detectOpenClaw, installOpenClawProvider, type InstallOptions } from './integrations/openclaw.js';
import { decide as decideLicense, readLicense, tryHandleLicenseRoute } from './license/index.js';
import {
  openaiRequestToAnthropic,
  anthropicResponseToOpenai,
  newStreamState,
  synthesizeOpenaiChunks,
  renderOpenaiChunk,
  OPENAI_DONE_SENTINEL,
  type OpenAiChatRequest,
  type AnthropicMessage,
} from './openai-compat.js';
import type {
  AuthReality,
  ProofRequest,
  ProofResponse,
  ProxyMode,
  StatusResponse,
} from './types.js';

export interface ProxyDescriptor {
  bind: '127.0.0.1';
  port: number;
  compatibility: 'openai-chat-completions' | 'anthropic-messages';
  telemetry: 'off';
  auth: 'local-oauth-bridge' | 'byo-anthropic-key' | 'not-configured';
  preferLocalBridge: boolean;
}

export function describeProxy(cfg: RuntimeConfig): ProxyDescriptor {
  const auth: ProxyDescriptor['auth'] = cfg.preferLocalBridge
    ? 'local-oauth-bridge'
    : cfg.anthropicApiKey
      ? 'byo-anthropic-key'
      : 'not-configured';
  return {
    bind: cfg.bind,
    port: cfg.port,
    compatibility: 'anthropic-messages',
    telemetry: 'off',
    auth,
    preferLocalBridge: cfg.preferLocalBridge,
  };
}

export async function buildAuthReality(cfg: RuntimeConfig): Promise<AuthReality> {
  const probe = await probeLocalBridge(cfg);
  const activeAuth: AuthReality['activeAuth'] =
    cfg.preferLocalBridge && probe.state === 'ready'
      ? 'local-oauth'
      : cfg.anthropicApiKey
        ? 'byo-anthropic-key'
        : 'none';
  return {
    sanctionedThirdPartyOAuth: false,
    claudeMaxDirectLogin: 'not-available',
    localOauthBridge: {
      state: probe.state,
      claudeBinaryDetected: probe.claudeBinaryDetected,
      claudeVersion: probe.claudeVersion,
      loggedIn: probe.loggedIn,
      authMethod: probe.authMethod,
      provider: probe.provider,
      bridgePath: probe.bridgePath,
      sameMachineOnly: true,
      portable: false,
      note: probe.note,
    },
    activeAuth,
    honestSummary:
      'The proven product identity is: Maxbridge shells into the locally logged-in ' +
      'Claude CLI (OAuth / Max subscription) on THIS Mac. That path has been verified ' +
      'end-to-end against claude-opus-4-7 here. It is NOT portable: another user on ' +
      'another Mac needs their own `claude setup-token` session. BYO Anthropic API key ' +
      'remains available as a fallback/dev mode, not the product core. There is no ' +
      'sanctioned Anthropic third-party OAuth path, so reusable friend-install mode ' +
      'is NOT proven and Maxbridge will not fake it.',
  };
}

export async function buildStatus(cfg: RuntimeConfig, version: string): Promise<StatusResponse> {
  const authReality = await buildAuthReality(cfg);
  const effectiveMode: ProxyMode =
    authReality.activeAuth === 'local-oauth'
      ? 'local-oauth'
      : authReality.activeAuth === 'byo-anthropic-key'
        ? 'byo-key'
        : 'stub';
  return {
    name: 'Maxbridge',
    version,
    endpoint: `http://${cfg.bind}:${cfg.port}`,
    mode: effectiveMode,
    defaultModel: cfg.defaultModel,
    keySource: cfg.anthropicApiKey ? 'env' : 'none',
    telemetry: 'off',
    passthrough: {
      chatCompletions: '/v1/chat/completions',
      messages: '/v1/messages',
      proof: '/v1/proof',
      localBridge: '/v1/local-bridge',
    },
    limits: [
      'Bound to 127.0.0.1 only.',
      'No body rewriting.',
      'No system prompt injection by the proxy.',
      'Proven mode: local Claude CLI OAuth bridge on THIS Mac (same user, same machine). Not portable to other machines.',
      'BYO Anthropic API key is a fallback/dev mode, not the product identity.',
      'Claude Max direct login (cross-machine reusable) is NOT available. No sanctioned third-party OAuth path exists. Not implemented, not coming soon, not faked.',
      'No persistence of the API key by default. If BYO-key fallback is used, set ANTHROPIC_API_KEY in your shell before launching.',
      '/v1/messages via the local CLI supports simple single-turn chat (role:user, content:text, stream:false). Streaming / tool_use / images fall back to BYO key or are declined with an explicit reason.',
      'OpenAI-compatible /v1/chat/completions is not implemented — returns 501. Use /v1/messages.',
    ],
    authReality,
  };
}

export async function runProof(
  req: ProofRequest,
  cfg: RuntimeConfig = loadRuntimeConfig(),
): Promise<ProofResponse> {
  // Priority:
  //  1. local-oauth bridge (proven path on this machine)
  //  2. BYO Anthropic API key (fallback/dev)
  //  3. clearly-labeled stub
  if (cfg.preferLocalBridge) {
    const probe = await probeLocalBridge(cfg);
    if (probe.state === 'ready') {
      return runLocalOauthProof(cfg, req);
    }
    // If the bridge is preferred but not ready, fall through. /v1/status
    // still reports bridge failure reason via authReality.localOauthBridge.
  }
  if (cfg.anthropicApiKey) {
    return runLiveProof(cfg, req);
  }
  return makeStubProof(cfg, req);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload).toString(),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-api-key, anthropic-version',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'x-maxbridge': 'proxy',
  });
  res.end(payload);
}

function writeCors(res: ServerResponse): void {
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-api-key, anthropic-version',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
  });
  res.end();
}

async function readBody(req: IncomingMessage, limitBytes = 2_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    total += buf.length;
    if (total > limitBytes) {
      throw new Error('Request body too large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// SSE emission is split into two phases so the proxy can flush `message_start`
// BEFORE the Claude CLI has produced anything — keeping the caller's idle
// timer alive during multi-minute tool chains. Callers that don't need the
// streaming heartbeat can still use the legacy one-shot `emitAnthropicSse`.

function emitSseHeaders(
  res: ServerResponse,
  msgId: string,
  model: string,
  inputTokens = 0,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
    'x-maxbridge': 'local-oauth-bridge-sse',
  });
  writeSseEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  });
  const anyRes = res as unknown as { flushHeaders?: () => void };
  if (typeof anyRes.flushHeaders === 'function') {
    try { anyRes.flushHeaders(); } catch { /* ignore */ }
  }
}

function emitSseBody(res: ServerResponse, body: any): void {
  const contentBlocks: any[] = Array.isArray(body?.content) ? body.content : [];
  const usage = body?.usage ?? { input_tokens: 0, output_tokens: 0 };
  const stopReason: string = typeof body?.stop_reason === 'string' ? body.stop_reason : 'end_turn';
  const stopSequence = body?.stop_sequence ?? null;

  contentBlocks.forEach((block, index) => {
    if (block?.type === 'text') {
      writeSseEvent(res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      const text = typeof block.text === 'string' ? block.text : '';
      writeSseEvent(res, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text },
      });
      writeSseEvent(res, 'content_block_stop', {
        type: 'content_block_stop',
        index,
      });
    }
  });

  writeSseEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: stopSequence },
    usage: { output_tokens: usage.output_tokens ?? 0 },
  });
  writeSseEvent(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

function emitAnthropicSse(
  res: ServerResponse,
  body: any,
  _status: number,
): void {
  const msgId: string = typeof body?.id === 'string' ? body.id : `msg_localclaw_${Date.now()}`;
  const model: string = typeof body?.model === 'string' ? body.model : 'claude-opus-4-7';
  const usage = body?.usage ?? { input_tokens: 0, output_tokens: 0 };
  emitSseHeaders(res, msgId, model, usage.input_tokens ?? 0);
  emitSseBody(res, body);
}

async function passthroughMessages(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: RuntimeConfig,
): Promise<void> {
  // License gate — spec §4. Open routes (/healthz, /v1/status, /v1/local-bridge,
  // /v1/integrations/*, /v1/license/*) are NOT gated; /v1/messages is.
  const licenseState = readLicense();
  const verdict = decideLicense(licenseState, new Date());
  if (!verdict.allow) {
    const payload = JSON.stringify({
      error: {
        type: 'maxbridge_license_required',
        message: verdict.reason === 'trial_expired'
          ? 'Your Maxbridge trial has ended. Upgrade to keep Opus 4.7 routing through your Max subscription.'
          : verdict.reason === 'subscription_lapsed'
            ? 'Your Maxbridge subscription has lapsed. Renew to restore Opus 4.7 routing.'
            : verdict.reason,
        next_step: verdict.nextStep ?? 'start_trial_or_buy',
        upgrade_url: verdict.upgradeUrl,
      },
    });
    res.writeHead(402, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload).toString(),
      'access-control-allow-origin': '*',
      'x-maxbridge': 'license-gate',
      'x-maxbridge-license-status': verdict.reason,
      ...(verdict.upgradeUrl ? { 'x-maxbridge-upgrade-url': verdict.upgradeUrl } : {}),
      ...verdict.headers,
    });
    res.end(payload);
    return;
  }

  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch (err) {
    writeJson(res, 413, { error: { type: 'localclaw_body_too_large', message: (err as Error).message } });
    return;
  }

  // 1. Local Claude CLI OAuth bridge (preferred, same-machine proven path).
  //    Only simple chat shapes are supported here; complex shapes or
  //    stream:true fall through to the BYO-key path when available.
  let parsedBody: AnthropicMessagesBody | null = null;
  if (bodyText.trim().length > 0) {
    try {
      parsedBody = JSON.parse(bodyText) as AnthropicMessagesBody;
    } catch (err) {
      writeJson(res, 400, {
        error: { type: 'localclaw_bad_request', message: `Invalid JSON body: ${(err as Error).message}` },
      });
      return;
    }
  }

  let localDeclineReason: string | null = null;
  if (cfg.preferLocalBridge && parsedBody) {
    const probe = await probeLocalBridge(cfg);
    if (probe.state === 'ready') {
      // Streaming path: flush SSE headers + `message_start` BEFORE spawning
      // the Claude CLI, then emit SSE comment heartbeats every 15s until the
      // CLI completes. Without this the caller (e.g. OpenClaw gateway) sees
      // zero bytes for the full tool-chain duration and its idle timer (90s
      // default in OpenClaw) trips, triggering a false fallback to a cheap
      // non-Opus model. The heartbeat lines use the SSE `:` comment syntax so
      // any compliant Anthropic client ignores them while the TCP stream
      // stays demonstrably alive.
      if (parsedBody.stream === true) {
        const requestedModel =
          typeof parsedBody.model === 'string' && parsedBody.model.trim()
            ? parsedBody.model.trim()
            : cfg.defaultModel;
        const msgId = `msg_localclaw_${Date.now().toString(36)}`;
        emitSseHeaders(res, msgId, requestedModel);
        const heartbeat = setInterval(() => {
          try {
            res.write(`: maxbridge-heartbeat ${Date.now()}\n\n`);
          } catch {
            /* ignore broken pipe */
          }
        }, 15_000);
        let heartbeatCleared = false;
        const stopHeartbeat = (): void => {
          if (heartbeatCleared) return;
          heartbeatCleared = true;
          clearInterval(heartbeat);
        };
        res.on('close', stopHeartbeat);
        try {
          const local = await runLocalOauthMessages(cfg, parsedBody);
          stopHeartbeat();
          if (local.ok) {
            emitSseBody(res, { ...local.body, id: msgId });
            return;
          }
          writeSseEvent(res, 'error', {
            type: 'error',
            error: {
              type: 'maxbridge_local_decline',
              message: local.reason ?? 'unknown',
            },
          });
          writeSseEvent(res, 'message_stop', { type: 'message_stop' });
          res.end();
          return;
        } catch (err) {
          stopHeartbeat();
          writeSseEvent(res, 'error', {
            type: 'error',
            error: {
              type: 'maxbridge_internal',
              message: (err as Error).message,
            },
          });
          try {
            writeSseEvent(res, 'message_stop', { type: 'message_stop' });
          } catch {
            /* ignore */
          }
          try {
            res.end();
          } catch {
            /* ignore */
          }
          return;
        }
      }

      // Non-streaming path: run CLI, return full JSON body when complete.
      const local = await runLocalOauthMessages(cfg, parsedBody);
      if (local.ok) {
        const payload = JSON.stringify(local.body);
        res.writeHead(local.status, {
          ...local.headers,
          'content-length': Buffer.byteLength(payload).toString(),
          'access-control-allow-origin': '*',
          'x-maxbridge': 'local-oauth-bridge',
        });
        res.end(payload);
        return;
      }
      localDeclineReason = local.reason;
    } else {
      localDeclineReason = `local-oauth bridge not ready (${probe.state})`;
    }
  }

  // 2. BYO Anthropic API key passthrough (fallback / dev).
  if (!cfg.anthropicApiKey) {
    writeJson(res, 503, {
      error: {
        type: 'localclaw_not_configured',
        message:
          'Maxbridge could not serve this /v1/messages request. The preferred local Claude CLI ' +
          'OAuth bridge declined or is not ready, and no BYO ANTHROPIC_API_KEY fallback is set.',
        localBridgeDecline: localDeclineReason,
        hint:
          'Simple single-turn chat requests (role:user, content:text, stream:false) are served by ' +
          'the local bridge. For streaming, tool_use, or multi-content shapes, set ' +
          'ANTHROPIC_API_KEY on the proxy or simplify the request.',
      },
    });
    return;
  }

  const upstreamUrl = cfg.anthropicBaseUrl.replace(/\/+$/, '') + '/v1/messages';
  const fwdHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': cfg.anthropicVersion,
    'x-api-key': cfg.anthropicApiKey,
  };
  for (const [k, v] of Object.entries(req.headers)) {
    const key = k.toLowerCase();
    if (key === 'anthropic-beta' && typeof v === 'string') {
      fwdHeaders['anthropic-beta'] = v;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: fwdHeaders,
      body: bodyText,
    });
  } catch (err) {
    writeJson(res, 502, {
      error: { type: 'localclaw_upstream_network', message: (err as Error).message },
    });
    return;
  }

  const respHeaders: Record<string, string> = {
    'access-control-allow-origin': '*',
    'x-maxbridge': 'passthrough',
  };
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'content-encoding' || k === 'content-length' || k === 'transfer-encoding') return;
    respHeaders[k] = value;
  });
  res.writeHead(upstream.status, respHeaders);

  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

function writeOpenaiError(res: ServerResponse, status: number, type: string, message: string, code: string): void {
  writeJson(res, status, {
    error: {
      message,
      type,
      param: null,
      code,
    },
  });
}

async function passthroughChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: RuntimeConfig,
): Promise<void> {
  // License gate (same rule as /v1/messages).
  const licenseState = readLicense();
  const verdict = decideLicense(licenseState, new Date());
  if (!verdict.allow) {
    const message = verdict.reason === 'trial_expired'
      ? 'Your Maxbridge trial has ended. Upgrade to keep Opus 4.7 routing through your Max subscription.'
      : verdict.reason === 'subscription_lapsed'
        ? 'Your Maxbridge subscription has lapsed. Renew to restore Opus 4.7 routing.'
        : verdict.reason;
    writeJson(res, 402, {
      error: {
        message,
        type: 'maxbridge_license_required',
        param: null,
        code: verdict.nextStep ?? 'license_required',
        upgrade_url: verdict.upgradeUrl,
      },
    });
    return;
  }

  // Body parse.
  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch (err) {
    writeOpenaiError(res, 413, 'invalid_request_error', (err as Error).message, 'body_too_large');
    return;
  }
  let openaiReq: OpenAiChatRequest;
  try {
    openaiReq = JSON.parse(bodyText) as OpenAiChatRequest;
  } catch (err) {
    writeOpenaiError(res, 400, 'invalid_request_error', `Invalid JSON body: ${(err as Error).message}`, 'bad_json');
    return;
  }

  // Translate OpenAI shape -> Anthropic shape.
  const translated = openaiRequestToAnthropic(openaiReq, {
    defaultModel: cfg.defaultModel,
    maxTokens: 4096,
  });
  if (!translated.ok) {
    writeOpenaiError(res, 400, 'invalid_request_error', translated.reason, 'bad_request');
    return;
  }
  const anthropicBody = translated.body;
  const isStreaming = openaiReq.stream === true;

  // Gate on local-oauth readiness. We do not currently use the BYO-key fallback
  // for /v1/chat/completions; callers get an explicit 503 if the CLI bridge is
  // not live so they can fall back to their own provider rather than silently
  // hitting an Anthropic API key path without knowing.
  if (!cfg.preferLocalBridge) {
    writeOpenaiError(res, 503, 'maxbridge_not_configured', 'local-oauth bridge disabled', 'bridge_disabled');
    return;
  }
  const probe = await probeLocalBridge(cfg);
  if (probe.state !== 'ready') {
    writeOpenaiError(res, 503, 'maxbridge_bridge_not_ready', probe.note, `bridge_${probe.state}`);
    return;
  }

  if (!isStreaming) {
    // Non-streaming: run CLI synchronously, translate Anthropic message ->
    // single OpenAI ChatCompletion JSON.
    const local = await runLocalOauthMessages(cfg, anthropicBody as unknown as AnthropicMessagesBody);
    if (!local.ok) {
      writeOpenaiError(res, 503, 'maxbridge_local_decline', local.reason ?? 'unknown', 'local_decline');
      return;
    }
    const resp = anthropicResponseToOpenai(local.body as AnthropicMessage);
    writeJson(res, 200, resp);
    return;
  }

  // Streaming: flush OpenAI SSE headers + role chunk immediately, emit 15s
  // heartbeat comments while the CLI runs, then synthesize the final chunks
  // from the Anthropic message and append [DONE].
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
    'x-maxbridge': 'openai-compat-sse',
  });
  const state = newStreamState(
    (typeof openaiReq.model === 'string' && openaiReq.model.trim())
      ? openaiReq.model.trim()
      : cfg.defaultModel,
  );
  res.write(renderOpenaiChunk({
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  }));
  const anyRes = res as unknown as { flushHeaders?: () => void };
  if (typeof anyRes.flushHeaders === 'function') {
    try { anyRes.flushHeaders(); } catch { /* ignore */ }
  }
  const heartbeat = setInterval(() => {
    try { res.write(`: maxbridge-heartbeat ${Date.now()}\n\n`); } catch { /* ignore */ }
  }, 15_000);
  let heartbeatCleared = false;
  const stopHeartbeat = (): void => {
    if (heartbeatCleared) return;
    heartbeatCleared = true;
    clearInterval(heartbeat);
  };
  res.on('close', stopHeartbeat);

  try {
    // Force stream:false for the CLI invocation — we synthesize the OpenAI
    // stream ourselves from the buffered Anthropic message below.
    const local = await runLocalOauthMessages(cfg, {
      ...anthropicBody,
      stream: false,
    } as unknown as AnthropicMessagesBody);
    stopHeartbeat();
    if (!local.ok) {
      res.write(`data: ${JSON.stringify({ error: { type: 'maxbridge_local_decline', message: local.reason ?? 'unknown' } })}\n\n`);
      res.write(OPENAI_DONE_SENTINEL);
      res.end();
      return;
    }
    const chunks = synthesizeOpenaiChunks(local.body as AnthropicMessage, state);
    // Skip the first chunk (role marker) since we already emitted one up-front
    // during the headers flush; synthesizeOpenaiChunks emits its own too.
    for (let i = 1; i < chunks.length; i++) {
      res.write(renderOpenaiChunk(chunks[i]));
    }
    res.write(OPENAI_DONE_SENTINEL);
    res.end();
  } catch (err) {
    stopHeartbeat();
    try {
      res.write(`data: ${JSON.stringify({ error: { type: 'maxbridge_internal', message: (err as Error).message } })}\n\n`);
      res.write(OPENAI_DONE_SENTINEL);
      res.end();
    } catch {
      /* ignore */
    }
  }
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: RuntimeConfig,
  version: string,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${cfg.bind}:${cfg.port}`);
    if (req.method === 'OPTIONS') {
      writeCors(res);
      return;
    }

    if (url.pathname === '/healthz' && req.method === 'GET') {
      writeJson(res, 200, { ok: true, mode: describeProxyMode(cfg) });
      return;
    }

    if (url.pathname === '/v1/status' && req.method === 'GET') {
      writeJson(res, 200, await buildStatus(cfg, version));
      return;
    }

    if (url.pathname === '/v1/local-bridge' && req.method === 'GET') {
      const probe = await probeLocalBridge(cfg);
      writeJson(res, 200, {
        ...probe,
        sameMachineOnly: true,
        portable: false,
        bridgePreferred: cfg.preferLocalBridge,
      });
      return;
    }

    // Back-compat alias for older UI builds.
    if (url.pathname === '/v1/cli-bridge' && req.method === 'GET') {
      const probe = await probeLocalBridge(cfg);
      writeJson(res, 200, probe);
      return;
    }

    if (url.pathname === '/v1/proof' && req.method === 'POST') {
      let payload: Partial<ProofRequest> = {};
      try {
        const bodyText = await readBody(req);
        if (bodyText.trim().length > 0) payload = JSON.parse(bodyText) as Partial<ProofRequest>;
      } catch (err) {
        writeJson(res, 400, { error: { type: 'bad_request', message: (err as Error).message } });
        return;
      }
      const challengeId = (payload.challengeId ?? '').trim();
      if (!challengeId) {
        writeJson(res, 400, {
          error: { type: 'bad_request', message: 'challengeId is required' },
        });
        return;
      }
      const proof = await runProof({ challengeId, model: payload.model }, cfg);
      writeJson(res, 200, proof);
      return;
    }

    if (url.pathname === '/v1/messages' && req.method === 'POST') {
      await passthroughMessages(req, res, cfg);
      return;
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      await passthroughChatCompletions(req, res, cfg);
      return;
    }

    // Maxbridge license routes — open (no gate) so unlicensed users can sign
    // up for a trial or activate a key. See spec §5.
    if (await tryHandleLicenseRoute(req, res, url.pathname)) {
      return;
    }

    // Maxbridge integration endpoints — used by the onboarding wizard to
    // detect and configure popular target apps (OpenClaw first; Cursor / Cline
    // / Aider come later).
    if (url.pathname === '/v1/integrations/openclaw/detect' && req.method === 'GET') {
      writeJson(res, 200, detectOpenClaw());
      return;
    }

    if (url.pathname === '/v1/integrations/openclaw/install' && req.method === 'POST') {
      let opts: InstallOptions = {};
      try {
        const bodyText = await readBody(req);
        if (bodyText.trim().length > 0) opts = JSON.parse(bodyText) as InstallOptions;
      } catch (err) {
        writeJson(res, 400, { error: { type: 'bad_request', message: (err as Error).message } });
        return;
      }
      // Default to the proxy's actual port so the installed provider points at
      // this Maxbridge instance, not a hard-coded value.
      const port = typeof opts.port === 'number' && opts.port > 0 ? opts.port : cfg.port;
      const result = installOpenClawProvider({ ...opts, port });
      writeJson(res, result.ok ? 200 : 422, result);
      return;
    }

    writeJson(res, 404, {
      error: { type: 'not_found', message: `No route for ${req.method} ${url.pathname}` },
    });
  } catch (err) {
    writeJson(res, 500, {
      error: { type: 'localclaw_internal', message: (err as Error).message },
    });
  }
}

export interface StartOptions {
  version: string;
  cfg?: RuntimeConfig;
}

export function startProxyServer(opts: StartOptions): { server: Server; cfg: RuntimeConfig } {
  const cfg = opts.cfg ?? loadRuntimeConfig();
  const server = createServer((req, res) => {
    void handleRequest(req, res, cfg, opts.version);
  });
  server.listen(cfg.port, cfg.bind);
  return { server, cfg };
}

export const proxyTodo = [
  'Extend /v1/messages over the local Claude CLI bridge to handle streaming (stream:true), tool_use, and multi-content shapes. Today only simple single-turn chat is served locally; everything else falls back to the BYO-key passthrough.',
  'Translate /v1/chat/completions to Anthropic /v1/messages so OpenAI clients work unchanged.',
  'Investigate whether a sanctioned reusable Claude Max OAuth flow exists for cross-machine installs — currently blocked, must not be faked.',
  'Store optional BYO API keys in macOS Keychain when the user opts in to persistence.',
  'Add request timeouts, cancellation, and abort-on-disconnect on /v1/messages.',
  'Add signed + notarized Tauri packaging workflow.',
] as const;
