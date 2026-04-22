import type { RuntimeConfig } from './config.js';
import type { ProofRequest, ProofResponse } from './types.js';

const PROOF_PROMPT_TEMPLATE = (challengeId: string) =>
  [
    'You are being asked to prove your identity for Maxbridge.',
    'Respond with EXACTLY the following four lines and nothing else:',
    '',
    'LINE 1: echo this challenge id verbatim: ' + challengeId,
    'LINE 2: state the model id you were instantiated as',
    "LINE 3: state today's UTC date in YYYY-MM-DD",
    'LINE 4: complete this phrase: "Raw voice, no rewrite — "',
  ].join('\n');

export function buildProofPrompt(challengeId: string): string {
  return PROOF_PROMPT_TEMPLATE(challengeId);
}

function redactAuthHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (key === 'x-api-key' || key === 'authorization') {
      out[k] = 'REDACTED';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function makeStubProof(cfg: RuntimeConfig, req: ProofRequest): ProofResponse {
  const model = req.model?.trim() || cfg.defaultModel;
  const now = new Date().toISOString();
  const note =
    'STUB MODE. No ANTHROPIC_API_KEY is set on the Maxbridge proxy, so no live model call was made. ' +
    'Set ANTHROPIC_API_KEY in the environment (or paste it in the onboarding screen) to enable live proof.';
  const fakeBody = {
    id: `proof_stub_${req.challengeId}`,
    type: 'message',
    role: 'assistant',
    model: 'maxbridge-stub',
    content: [
      {
        type: 'text',
        text:
          'STUB — no live model call was made.\n' +
          'LINE 1: echo this challenge id verbatim: ' +
          req.challengeId +
          '\nLINE 2: (stub) no model was instantiated' +
          "\nLINE 3: (stub) no live timestamp" +
          '\nLINE 4: Raw voice, no rewrite — (stub)',
      },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  return {
    mode: 'stub',
    endpoint: `http://${cfg.bind}:${cfg.port}`,
    requestedModel: model,
    respondedModel: 'maxbridge-stub',
    challengeId: req.challengeId,
    sentAt: now,
    receivedAt: now,
    requestHeaders: {
      'content-type': 'application/json',
      'x-maxbridge-mode': 'stub',
    },
    responseHeaders: {
      'x-maxbridge-mode': 'stub',
      'x-maxbridge-notice': 'no upstream call performed',
    },
    rawBody: JSON.stringify(fakeBody, null, 2),
    streamedText: fakeBody.content[0].text,
    sseChunks: [],
    parsedJson: fakeBody,
    upstreamStatus: null,
    note,
    error: null,
  };
}

export async function runLiveProof(
  cfg: RuntimeConfig,
  req: ProofRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ProofResponse> {
  if (!cfg.anthropicApiKey) {
    return makeStubProof(cfg, req);
  }
  const model = req.model?.trim() || cfg.defaultModel;
  const url = cfg.anthropicBaseUrl.replace(/\/+$/, '') + '/v1/messages';
  const prompt = buildProofPrompt(req.challengeId);
  const sentAt = new Date().toISOString();

  const requestHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': cfg.anthropicVersion,
    'x-api-key': cfg.anthropicApiKey,
  };

  const body = {
    model,
    max_tokens: 256,
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  };

  let upstreamResp: Response;
  try {
    upstreamResp = await fetchImpl(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      mode: 'byo-key',
      endpoint: `http://${cfg.bind}:${cfg.port}`,
      requestedModel: model,
      respondedModel: null,
      challengeId: req.challengeId,
      sentAt,
      receivedAt: new Date().toISOString(),
      requestHeaders: redactAuthHeaders(requestHeaders),
      responseHeaders: {},
      rawBody: '',
      streamedText: '',
      sseChunks: [],
      parsedJson: null,
      upstreamStatus: null,
      note: null,
      error: `Network error contacting upstream: ${(err as Error).message}`,
    };
  }

  const respHeaders = headersToRecord(upstreamResp.headers);
  const sseChunks: string[] = [];
  let accumulatedText = '';
  let respondedModel: string | null = null;
  let rawBody = '';

  if (!upstreamResp.ok || !upstreamResp.body) {
    const fallback = await upstreamResp.text();
    return {
      mode: 'byo-key',
      endpoint: `http://${cfg.bind}:${cfg.port}`,
      requestedModel: model,
      respondedModel: null,
      challengeId: req.challengeId,
      sentAt,
      receivedAt: new Date().toISOString(),
      requestHeaders: redactAuthHeaders(requestHeaders),
      responseHeaders: respHeaders,
      rawBody: fallback,
      streamedText: '',
      sseChunks: [],
      parsedJson: safeJsonParse(fallback),
      upstreamStatus: upstreamResp.status,
      note: null,
      error: `Upstream returned ${upstreamResp.status}`,
    };
  }

  const reader = upstreamResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    rawBody += text;
    buffer += text;
    let sepIdx = buffer.indexOf('\n\n');
    while (sepIdx !== -1) {
      const chunk = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      if (chunk.trim().length > 0) {
        sseChunks.push(chunk);
        const parsed = parseSseEvent(chunk);
        if (parsed) {
          if (parsed.type === 'message_start' && parsed.message?.model) {
            respondedModel = parsed.message.model;
          }
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            accumulatedText += parsed.delta.text ?? '';
          }
        }
      }
      sepIdx = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim().length > 0) {
    sseChunks.push(buffer);
  }

  return {
    mode: 'byo-key',
    endpoint: `http://${cfg.bind}:${cfg.port}`,
    requestedModel: model,
    respondedModel,
    challengeId: req.challengeId,
    sentAt,
    receivedAt: new Date().toISOString(),
    requestHeaders: redactAuthHeaders(requestHeaders),
    responseHeaders: respHeaders,
    rawBody,
    streamedText: accumulatedText,
    sseChunks,
    parsedJson: null,
    upstreamStatus: upstreamResp.status,
    note: null,
    error: null,
  };
}

interface SseEvent {
  type: string;
  message?: { model?: string };
  delta?: { type?: string; text?: string };
}

function parseSseEvent(chunk: string): SseEvent | null {
  for (const line of chunk.split('\n')) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') return null;
      try {
        return JSON.parse(data) as SseEvent;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
