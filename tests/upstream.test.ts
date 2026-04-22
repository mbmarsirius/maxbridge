import { describe, expect, it } from 'vitest';
import { buildProofPrompt, makeStubProof, runLiveProof } from '../server/upstream';
import { loadRuntimeConfig } from '../server/config';

describe('upstream helpers', () => {
  it('buildProofPrompt includes the challenge id and a no-rewrite instruction', () => {
    const prompt = buildProofPrompt('abc-123');
    expect(prompt).toContain('abc-123');
    expect(prompt).toMatch(/echo this challenge id/i);
    expect(prompt).toMatch(/Raw voice, no rewrite/);
  });

  it('makeStubProof echoes the challenge and marks stub mode', () => {
    const cfg = loadRuntimeConfig({});
    const stub = makeStubProof(cfg, { challengeId: 'xyz-9' });
    expect(stub.mode).toBe('stub');
    expect(stub.streamedText).toContain('xyz-9');
    expect(stub.respondedModel).toBe('maxbridge-stub');
  });

  it('runLiveProof surfaces upstream errors honestly', async () => {
    const cfg = loadRuntimeConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const boom = (async () => {
      throw new Error('DNS lookup failed');
    }) as unknown as typeof fetch;
    const result = await runLiveProof(cfg, { challengeId: 'abc' }, boom);
    expect(result.mode).toBe('byo-key');
    expect(result.error).toMatch(/DNS lookup failed/);
    expect(result.respondedModel).toBeNull();
  });

  it('runLiveProof falls back to stub when no key is configured', async () => {
    const cfg = loadRuntimeConfig({});
    const result = await runLiveProof(cfg, { challengeId: 'abc' });
    expect(result.mode).toBe('stub');
  });
});
