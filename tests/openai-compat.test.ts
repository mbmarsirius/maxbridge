import { describe, expect, it } from 'vitest';
import {
  openaiRequestToAnthropic,
  anthropicResponseToOpenai,
  newStreamState,
  synthesizeOpenaiChunks,
  type OpenAiChatRequest,
  type AnthropicMessage,
} from '../server/openai-compat.js';

const defaults = { defaultModel: 'claude-opus-4-7', maxTokens: 1024 };

describe('openaiRequestToAnthropic', () => {
  it('collapses system messages and translates basic chat', () => {
    const req: OpenAiChatRequest = {
      model: 'claude-opus-4-7',
      max_tokens: 200,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Hi' },
      ],
    };
    const out = openaiRequestToAnthropic(req, defaults);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.body.system).toBe('You are terse.');
    expect(out.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    ]);
    expect(out.body.max_tokens).toBe(200);
    expect(out.body.temperature).toBe(0.2);
    expect(out.body.stream).toBe(false);
  });

  it('translates tool definitions, tool_calls, and tool results', () => {
    const req: OpenAiChatRequest = {
      messages: [
        { role: 'user', content: 'What is the weather in Paris?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '18C, cloudy' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Fetch current weather',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        },
      ],
      tool_choice: 'required',
    };
    const out = openaiRequestToAnthropic(req, defaults);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const msgs = out.body.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'What is the weather in Paris?' }] });
    expect(msgs[1].role).toBe('assistant');
    const asstBlocks = msgs[1].content as Array<Record<string, unknown>>;
    // Empty assistant text block is allowed but the tool_use must be present.
    const toolUse = asstBlocks.find((b) => b.type === 'tool_use');
    expect(toolUse).toEqual({ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Paris' } });
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '18C, cloudy' }],
    });
    expect(out.body.tools).toEqual([
      {
        name: 'get_weather',
        description: 'Fetch current weather',
        input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      },
    ]);
    expect(out.body.tool_choice).toEqual({ type: 'any' });
  });

  it('rejects empty messages array', () => {
    const out = openaiRequestToAnthropic({ messages: [] }, defaults);
    expect(out.ok).toBe(false);
  });

  it('merges consecutive tool results into the same user turn', () => {
    const req: OpenAiChatRequest = {
      messages: [
        { role: 'user', content: 'Run two checks' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'a', type: 'function', function: { name: 'a', arguments: '{}' } },
            { id: 'b', type: 'function', function: { name: 'b', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'a', content: 'A-ok' },
        { role: 'tool', tool_call_id: 'b', content: 'B-ok' },
      ],
    };
    const out = openaiRequestToAnthropic(req, defaults);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const third = out.body.messages[2];
    expect(third.role).toBe('user');
    expect((third.content as unknown[]).length).toBe(2);
  });
});

describe('anthropicResponseToOpenai', () => {
  it('translates a plain text message', () => {
    const msg: AnthropicMessage = {
      id: 'msg_abc',
      role: 'assistant',
      content: [{ type: 'text', text: 'hello world' }],
      model: 'claude-opus-4-7',
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    };
    const out = anthropicResponseToOpenai(msg);
    expect(out.object).toBe('chat.completion');
    expect(out.model).toBe('claude-opus-4-7');
    expect(out.choices[0].message.content).toBe('hello world');
    expect(out.choices[0].message.tool_calls).toBeUndefined();
    expect(out.choices[0].finish_reason).toBe('stop');
    expect(out.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  });

  it('translates tool_use blocks into tool_calls with serialized arguments', () => {
    const msg: AnthropicMessage = {
      id: 'msg_tool',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking up...' },
        { type: 'tool_use', id: 'call_42', name: 'get_weather', input: { city: 'Paris' } },
      ],
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
    };
    const out = anthropicResponseToOpenai(msg);
    expect(out.choices[0].message.content).toBe('Looking up...');
    expect(out.choices[0].message.tool_calls).toEqual([
      {
        id: 'call_42',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
      },
    ]);
    expect(out.choices[0].finish_reason).toBe('tool_calls');
  });

  it('maps max_tokens stop reason to length', () => {
    const msg: AnthropicMessage = {
      id: 'msg_len',
      role: 'assistant',
      content: [{ type: 'text', text: 'truncated' }],
      model: 'claude-opus-4-7',
      stop_reason: 'max_tokens',
    };
    expect(anthropicResponseToOpenai(msg).choices[0].finish_reason).toBe('length');
  });
});

describe('synthesizeOpenaiChunks', () => {
  it('emits role chunk, content chunk, and finish chunk for text response', () => {
    const msg: AnthropicMessage = {
      id: 'msg_stream',
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      model: 'claude-opus-4-7',
      stop_reason: 'end_turn',
    };
    const state = newStreamState('claude-opus-4-7');
    const chunks = synthesizeOpenaiChunks(msg, state);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].choices[0].delta.role).toBe('assistant');
    expect(chunks[1].choices[0].delta.content).toBe('hi');
    expect(chunks[2].choices[0].finish_reason).toBe('stop');
  });

  it('synthesizes tool_calls chunks for tool_use blocks', () => {
    const msg: AnthropicMessage = {
      id: 'msg_tool_stream',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'call_1', name: 'x', input: { y: 1 } },
      ],
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
    };
    const state = newStreamState('claude-opus-4-7');
    const chunks = synthesizeOpenaiChunks(msg, state);
    // role, tool_calls, finish
    expect(chunks).toHaveLength(3);
    const toolChunk = chunks[1];
    expect(toolChunk.choices[0].delta.tool_calls?.[0]).toEqual({
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'x', arguments: '{"y":1}' },
    });
    expect(chunks[2].choices[0].finish_reason).toBe('tool_calls');
  });
});
