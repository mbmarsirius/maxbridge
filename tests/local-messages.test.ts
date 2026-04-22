import { describe, expect, it } from 'vitest';
import { buildLocalPromptFromMessages } from '../server/local-oauth-bridge';

describe('buildLocalPromptFromMessages', () => {
  it('accepts a simple single-turn user string message', () => {
    const out = buildLocalPromptFromMessages({
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Reply with PONG only.' }],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected ok');
    expect(out.userTurns).toBe(1);
    expect(out.prompt).toContain('[user]');
    expect(out.prompt).toContain('Reply with PONG only.');
    expect(out.prompt.endsWith('[assistant]')).toBe(true);
  });

  it('flattens text blocks and includes a system prompt', () => {
    const out = buildLocalPromptFromMessages({
      system: 'be terse',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second' },
          ],
        },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected ok');
    expect(out.prompt).toMatch(/\[system\][\s\S]*be terse/);
    expect(out.prompt).toMatch(/first[\s\S]*second/);
  });

  it('accepts stream:true — proxy layer converts the buffered message into an SSE stream', () => {
    const out = buildLocalPromptFromMessages({
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected ok');
    expect(out.userTurns).toBe(1);
    expect(out.prompt).toContain('hi');
  });

  it('drops unsupported content blocks (image, document) silently rather than rejecting', () => {
    const out = buildLocalPromptFromMessages({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'image', text: undefined },
          ] as unknown as Array<{ type: string; text?: string }>,
        },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected ok');
    // Only the text block survives; image is dropped silently.
    expect(out.prompt).toContain('hello');
    expect(out.prompt).not.toContain('image');
  });

  it('renders prior tool_use and tool_result blocks as narrated text', () => {
    const out = buildLocalPromptFromMessages({
      messages: [
        { role: 'user', content: 'what is the weather?' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', text: undefined } as unknown as { type: string },
          ] as unknown as Array<{ type: string }>,
        },
      ],
    });
    // Even with a bare tool_use block, the prompt builder should succeed —
    // the tool_use is folded into narrated text, not treated as a hard error.
    expect(out.ok).toBe(true);
  });

  it('declines unsupported roles', () => {
    const out = buildLocalPromptFromMessages({
      messages: [{ role: 'tool', content: 'result' }],
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected decline');
    expect(out.reason).toMatch(/unsupported role/i);
  });

  it('requires at least one user turn', () => {
    const out = buildLocalPromptFromMessages({
      messages: [{ role: 'assistant', content: 'leftover' }],
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected decline');
    expect(out.reason).toMatch(/no user turn/i);
  });

  it('rejects empty messages array', () => {
    const out = buildLocalPromptFromMessages({ messages: [] });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected decline');
    expect(out.reason).toMatch(/required/i);
  });
});
