// OpenAI `/v1/chat/completions` ↔ Anthropic `/v1/messages` translation.
//
// Lets any OpenAI-compatible client (Cursor, Cline, Aider, Continue, Open WebUI,
// custom scripts using `openai` SDK, etc.) talk to Maxbridge without the caller
// knowing it's actually an Anthropic-shape proxy.
//
// Scope:
//   - Chat request/response shape translation, including system prompt,
//     user/assistant turns, and tool_use / tool_result round-trips.
//   - Streaming: Anthropic SSE events -> OpenAI chunk deltas, terminated with
//     the OpenAI-standard `data: [DONE]\n\n` sentinel.
//   - Non-streaming: single JSON Completion response with tool_calls.
//
// Out of scope (silently ignored or dropped):
//   - `function_call`/`functions` legacy OpenAI fields (replaced by `tools`).
//   - `n > 1` (multi-sampling) — always returns a single choice.
//   - `logprobs`, `logit_bias`, `presence_penalty`, `frequency_penalty` —
//     Anthropic has no equivalent.
//   - Audio/vision in the OpenAI request shape (use /v1/messages for native
//     Anthropic image blocks).

export interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAiChatRequest {
  model?: string;
  messages: OpenAiChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  tools?: OpenAiTool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  user?: string;
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<Record<string, unknown>>;
  }>;
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?:
    | { type: 'auto' }
    | { type: 'any' }
    | { type: 'tool'; name: string }
    | { type: 'none' };
  metadata?: { user_id?: string };
}

function flattenOpenAiContent(
  content: OpenAiChatMessage['content'],
): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
    // image_url and other block types are dropped — native Anthropic images
    // should use /v1/messages directly.
  }
  return parts.join('\n');
}

/**
 * Translate an OpenAI chat/completions request body into an Anthropic
 * /v1/messages body.
 *
 * System messages are collapsed into Anthropic's top-level `system` string
 * (concatenated with newlines if the caller sent multiple). Tool calls and
 * tool results are expanded into tool_use / tool_result content blocks.
 */
export function openaiRequestToAnthropic(
  req: OpenAiChatRequest,
  defaults: { defaultModel: string; maxTokens: number },
): { ok: true; body: AnthropicMessagesRequest } | { ok: false; reason: string } {
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    return { ok: false, reason: 'messages must be a non-empty array' };
  }

  const systemParts: string[] = [];
  const anthropicMessages: AnthropicMessagesRequest['messages'] = [];

  // Tool definitions carry over name -> description so we can re-project them
  // at response time if needed. (OpenAI names map 1:1 to Anthropic names.)
  for (const msg of req.messages) {
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role;

    if (role === 'system' || role === 'developer') {
      const txt = flattenOpenAiContent(msg.content);
      if (txt) systemParts.push(txt);
      continue;
    }

    if (role === 'user') {
      const txt = flattenOpenAiContent(msg.content);
      anthropicMessages.push({
        role: 'user',
        content: [{ type: 'text', text: txt }],
      });
      continue;
    }

    if (role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      const txt = flattenOpenAiContent(msg.content);
      if (txt) blocks.push({ type: 'text', text: txt });
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (!tc?.function?.name) continue;
          let parsedArgs: unknown = {};
          try {
            parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            parsedArgs = { _raw: tc.function.arguments };
          }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parsedArgs,
          });
        }
      }
      if (blocks.length === 0) {
        // Empty assistant turn — Anthropic still needs content; use empty text.
        blocks.push({ type: 'text', text: '' });
      }
      anthropicMessages.push({ role: 'assistant', content: blocks });
      continue;
    }

    if (role === 'tool') {
      const resultText = flattenOpenAiContent(msg.content);
      if (!msg.tool_call_id) {
        return { ok: false, reason: 'tool message missing tool_call_id' };
      }
      // Anthropic expects tool_result blocks on a user-role message. If the
      // previous translated message is already a user turn, append; otherwise
      // start a new user turn.
      const last = anthropicMessages[anthropicMessages.length - 1];
      const toolResultBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: resultText,
      };
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as Array<Record<string, unknown>>).push(toolResultBlock);
      } else {
        anthropicMessages.push({
          role: 'user',
          content: [toolResultBlock],
        });
      }
      continue;
    }

    // Unknown role — skip silently.
  }

  if (anthropicMessages.length === 0) {
    return { ok: false, reason: 'no user or assistant messages after translation' };
  }

  const model = (typeof req.model === 'string' && req.model.trim())
    ? req.model.trim()
    : defaults.defaultModel;

  const maxTokens = typeof req.max_completion_tokens === 'number' && req.max_completion_tokens > 0
    ? req.max_completion_tokens
    : typeof req.max_tokens === 'number' && req.max_tokens > 0
      ? req.max_tokens
      : defaults.maxTokens;

  const body: AnthropicMessagesRequest = {
    model,
    messages: anthropicMessages,
    max_tokens: maxTokens,
    stream: req.stream === true,
  };

  if (systemParts.length > 0) body.system = systemParts.join('\n\n');
  if (typeof req.temperature === 'number') body.temperature = req.temperature;
  if (typeof req.top_p === 'number') body.top_p = req.top_p;
  if (typeof req.stop === 'string') body.stop_sequences = [req.stop];
  else if (Array.isArray(req.stop)) body.stop_sequences = req.stop.filter((s): s is string => typeof s === 'string');
  if (typeof req.user === 'string') body.metadata = { user_id: req.user };

  if (Array.isArray(req.tools) && req.tools.length > 0) {
    body.tools = [];
    for (const t of req.tools) {
      if (t?.type !== 'function' || !t.function?.name) continue;
      body.tools.push({
        name: t.function.name,
        description: t.function.description,
        input_schema: (t.function.parameters as Record<string, unknown>) ?? {
          type: 'object',
          properties: {},
        },
      });
    }
    if (body.tools.length === 0) {
      delete body.tools;
    }
  }

  if (req.tool_choice) {
    if (req.tool_choice === 'auto') body.tool_choice = { type: 'auto' };
    else if (req.tool_choice === 'required') body.tool_choice = { type: 'any' };
    else if (req.tool_choice === 'none') body.tool_choice = { type: 'none' };
    else if (typeof req.tool_choice === 'object' && req.tool_choice.type === 'function') {
      body.tool_choice = { type: 'tool', name: req.tool_choice.function.name };
    }
  }

  return { ok: true, body };
}

function mapStopReason(stop: string | null | undefined): 'stop' | 'length' | 'tool_calls' | 'content_filter' | null {
  if (!stop) return null;
  switch (stop) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

export interface AnthropicMessage {
  id: string;
  type?: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text' | 'tool_use' | string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  model: string;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface OpenAiChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
}

/**
 * Translate a completed Anthropic Message into an OpenAI ChatCompletion.
 *
 * Text content blocks are concatenated into `choices[0].message.content`.
 * tool_use blocks become `tool_calls[]` with JSON-stringified arguments.
 */
export function anthropicResponseToOpenai(
  msg: AnthropicMessage,
): OpenAiChatCompletion {
  const textParts: string[] = [];
  const toolCalls: NonNullable<OpenAiChatCompletion['choices'][0]['message']['tool_calls']> = [];
  for (const block of msg.content ?? []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
      continue;
    }
    if (block.type === 'tool_use' && block.id && block.name) {
      let argsStr: string;
      try {
        argsStr = JSON.stringify(block.input ?? {});
      } catch {
        argsStr = '{}';
      }
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: argsStr },
      });
    }
  }

  const choice: OpenAiChatCompletion['choices'][0] = {
    index: 0,
    message: {
      role: 'assistant',
      content: textParts.length > 0 ? textParts.join('') : null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    finish_reason: mapStopReason(msg.stop_reason),
  };

  const input_tokens = msg.usage?.input_tokens ?? 0;
  const output_tokens = msg.usage?.output_tokens ?? 0;

  return {
    id: `chatcmpl-${(msg.id || 'none').replace(/^msg_/, '')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: msg.model,
    choices: [choice],
    usage: {
      prompt_tokens: input_tokens,
      completion_tokens: output_tokens,
      total_tokens: input_tokens + output_tokens,
    },
    system_fingerprint: 'maxbridge',
  };
}

// Streaming state: accumulates per-index tool_use blocks so we can emit
// OpenAI-style tool_calls deltas (which carry `arguments` as a rolling string).
export interface StreamState {
  id: string;
  model: string;
  created: number;
  toolCallsByIndex: Map<
    number,
    { id: string; name: string; openaiIndex: number }
  >;
  nextOpenaiToolIndex: number;
  firstContentEmitted: boolean;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export function newStreamState(model: string): StreamState {
  return {
    id: `chatcmpl-${Math.random().toString(36).slice(2, 12)}`,
    model,
    created: Math.floor(Date.now() / 1000),
    toolCallsByIndex: new Map(),
    nextOpenaiToolIndex: 0,
    firstContentEmitted: false,
    finishReason: null,
  };
}

export interface OpenAiStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
}

function makeChunk(
  state: StreamState,
  delta: OpenAiStreamChunk['choices'][0]['delta'],
  finish: OpenAiStreamChunk['choices'][0]['finish_reason'] = null,
): OpenAiStreamChunk {
  return {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

/**
 * Consume a single parsed Anthropic SSE event and return the list of OpenAI
 * stream chunks to forward to the caller. Returns [] for events that don't map.
 *
 * Emit semantics:
 *   - `message_start` → initial chunk with role=assistant
 *   - `content_block_start(text)` → (no-op; wait for delta)
 *   - `content_block_start(tool_use)` → tool_calls chunk with id + name
 *   - `content_block_delta(text_delta)` → content chunk with text
 *   - `content_block_delta(input_json_delta)` → tool_calls chunk with args
 *   - `content_block_stop` → (no-op)
 *   - `message_delta(stop_reason)` → records finish_reason for final chunk
 *   - `message_stop` → emit final chunk with finish_reason + caller appends
 *     `data: [DONE]\n\n`
 */
export function anthropicSseEventToOpenaiChunks(
  event: { type?: string; message?: any; index?: number; content_block?: any; delta?: any },
  state: StreamState,
): OpenAiStreamChunk[] {
  const out: OpenAiStreamChunk[] = [];
  const t = event.type;

  if (t === 'message_start' && event.message) {
    if (typeof event.message.model === 'string') state.model = event.message.model;
    out.push(makeChunk(state, { role: 'assistant', content: '' }));
    return out;
  }

  if (t === 'content_block_start' && event.content_block) {
    const cb = event.content_block;
    if (cb.type === 'tool_use' && typeof cb.id === 'string' && typeof cb.name === 'string') {
      const anthIdx = typeof event.index === 'number' ? event.index : state.toolCallsByIndex.size;
      const openaiIndex = state.nextOpenaiToolIndex++;
      state.toolCallsByIndex.set(anthIdx, { id: cb.id, name: cb.name, openaiIndex });
      out.push(
        makeChunk(state, {
          tool_calls: [
            {
              index: openaiIndex,
              id: cb.id,
              type: 'function',
              function: { name: cb.name, arguments: '' },
            },
          ],
        }),
      );
    }
    return out;
  }

  if (t === 'content_block_delta' && event.delta) {
    const d = event.delta;
    if (d.type === 'text_delta' && typeof d.text === 'string') {
      out.push(makeChunk(state, { content: d.text }));
      state.firstContentEmitted = true;
    } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
      const anthIdx = typeof event.index === 'number' ? event.index : -1;
      const tc = state.toolCallsByIndex.get(anthIdx);
      if (tc) {
        out.push(
          makeChunk(state, {
            tool_calls: [
              { index: tc.openaiIndex, function: { arguments: d.partial_json } },
            ],
          }),
        );
      }
    }
    return out;
  }

  if (t === 'message_delta' && event.delta) {
    const d = event.delta;
    if (typeof d.stop_reason === 'string') {
      state.finishReason = mapStopReason(d.stop_reason);
    }
    return out;
  }

  if (t === 'message_stop') {
    out.push(makeChunk(state, {}, state.finishReason ?? 'stop'));
    return out;
  }

  // ping, error, unknown → no-op.
  return out;
}

/**
 * Render an OpenAI stream chunk into its `data: <json>\n\n` SSE line.
 */
export function renderOpenaiChunk(chunk: OpenAiStreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export const OPENAI_DONE_SENTINEL = 'data: [DONE]\n\n';

/**
 * Synthesize a valid OpenAI chat-completions chunk stream from a completed
 * Anthropic message. Used when the underlying transport buffered the full
 * reply (e.g. non-streaming CLI spawn) but the caller asked for stream:true.
 *
 * Emitted order: role chunk -> content/tool_use chunks -> finish chunk.
 * Caller is responsible for appending OPENAI_DONE_SENTINEL after these chunks.
 */
export function synthesizeOpenaiChunks(
  msg: AnthropicMessage,
  state: StreamState,
): OpenAiStreamChunk[] {
  const chunks: OpenAiStreamChunk[] = [];
  if (typeof msg.model === 'string' && msg.model.length > 0) {
    state.model = msg.model;
  }
  // Initial role marker — some OpenAI clients (e.g. Cursor) expect the first
  // chunk to carry role=assistant before any content bytes.
  chunks.push(makeChunk(state, { role: 'assistant', content: '' }));

  for (const block of msg.content ?? []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      chunks.push(makeChunk(state, { content: block.text }));
      state.firstContentEmitted = true;
      continue;
    }
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      const openaiIndex = state.nextOpenaiToolIndex++;
      state.toolCallsByIndex.set(openaiIndex, {
        id: block.id,
        name: block.name,
        openaiIndex,
      });
      let argsStr: string;
      try {
        argsStr = JSON.stringify(block.input ?? {});
      } catch {
        argsStr = '{}';
      }
      chunks.push(
        makeChunk(state, {
          tool_calls: [
            {
              index: openaiIndex,
              id: block.id,
              type: 'function',
              function: { name: block.name, arguments: argsStr },
            },
          ],
        }),
      );
      continue;
    }
  }

  const finish = mapStopReason(msg.stop_reason) ?? 'stop';
  chunks.push(makeChunk(state, {}, finish));
  return chunks;
}
