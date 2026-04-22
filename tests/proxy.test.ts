import { describe, expect, it } from 'vitest';
import { buildAuthReality, buildStatus, describeProxy, runProof } from '../server/proxy';
import { loadRuntimeConfig } from '../server/config';

// Tests exercise the proxy description + status surface. The local-OAuth
// bridge is probed at runtime: to keep tests hermetic we force the claude
// binary to a non-existent path so probeLocalBridge reliably reports
// state=cli-missing. Real bridge integration is exercised manually on-machine.
const HERMETIC_BINARY = '/nonexistent/claude-binary-for-tests';

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    LOCALCLAW_CLAUDE_BINARY: HERMETIC_BINARY,
    LOCALCLAW_PREFER_LOCAL_BRIDGE: '0',
    LOCALCLAW_BRIDGE_PATH: '/nonexistent/bridge.sh',
    ...overrides,
  };
}

describe('proxy scaffold', () => {
  it('keeps the alpha proxy local only', () => {
    const cfg = loadRuntimeConfig(baseEnv());
    const desc = describeProxy(cfg);
    expect(desc.bind).toBe('127.0.0.1');
    expect(desc.port).toBe(7423);
    expect(desc.telemetry).toBe('off');
    expect(desc.auth).toBe('not-configured');
    expect(desc.preferLocalBridge).toBe(false);
  });

  it('reports byo-anthropic-key when an API key is configured (and local bridge not preferred)', () => {
    const cfg = loadRuntimeConfig(baseEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }));
    const desc = describeProxy(cfg);
    expect(desc.auth).toBe('byo-anthropic-key');
  });

  it('reports local-oauth-bridge as preferred backend when LOCALCLAW_PREFER_LOCAL_BRIDGE is on', () => {
    const cfg = loadRuntimeConfig({
      LOCALCLAW_CLAUDE_BINARY: HERMETIC_BINARY,
      LOCALCLAW_PREFER_LOCAL_BRIDGE: '1',
      LOCALCLAW_BRIDGE_PATH: '/nonexistent/bridge.sh',
    });
    const desc = describeProxy(cfg);
    expect(desc.auth).toBe('local-oauth-bridge');
    expect(desc.preferLocalBridge).toBe(true);
  });

  it('buildStatus advertises the real routes and honest boundaries', async () => {
    const cfg = loadRuntimeConfig(baseEnv());
    const status = await buildStatus(cfg, '0.1.0-alpha.2');
    expect(status.name).toBe('Maxbridge');
    expect(['stub', 'byo-key', 'local-oauth']).toContain(status.mode);
    expect(status.defaultModel).toBe('claude-opus-4-7');
    expect(status.passthrough.messages).toBe('/v1/messages');
    expect(status.passthrough.proof).toBe('/v1/proof');
    expect(status.passthrough.localBridge).toBe('/v1/local-bridge');
    expect(status.limits.join(' ')).toMatch(/127\.0\.0\.1/);
    expect(status.limits.join(' ')).toMatch(/not implemented/i);
    expect(status.limits.join(' ')).toMatch(/local Claude CLI OAuth/i);
  });

  it('buildAuthReality reports no sanctioned 3rd-party OAuth, and records local bridge state', async () => {
    const cfg = loadRuntimeConfig(baseEnv());
    const reality = await buildAuthReality(cfg);
    expect(reality.sanctionedThirdPartyOAuth).toBe(false);
    expect(reality.claudeMaxDirectLogin).toBe('not-available');
    expect(reality.localOauthBridge.portable).toBe(false);
    expect(reality.localOauthBridge.sameMachineOnly).toBe(true);
    // Binary is hermetic fake, so the bridge must report cli-missing.
    expect(reality.localOauthBridge.state).toBe('cli-missing');
    expect(reality.honestSummary).toMatch(/proven/i);
  });

  it('buildAuthReality reports byo-anthropic-key as active when a key is set and bridge is unready', async () => {
    const cfg = loadRuntimeConfig(baseEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }));
    const reality = await buildAuthReality(cfg);
    expect(reality.activeAuth).toBe('byo-anthropic-key');
    expect(reality.claudeMaxDirectLogin).toBe('not-available');
  });

  it('runProof returns a clearly-labeled stub when no auth is available', async () => {
    const cfg = loadRuntimeConfig(baseEnv());
    const result = await runProof({ challengeId: 'abc-123' }, cfg);
    expect(result.mode).toBe('stub');
    expect(result.challengeId).toBe('abc-123');
    expect(result.respondedModel).toBe('maxbridge-stub');
    expect(result.note ?? '').toMatch(/stub/i);
    expect(result.rawBody).toContain('abc-123');
  });

  it('runProof attempts a live BYO-key call when a key is configured (network mocked)', async () => {
    const origFetch = globalThis.fetch;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"claude-opus-4-7"}}\n\n',
          ),
        );
        controller.enqueue(
          enc.encode(
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"echo-abc-123"}}\n\n',
          ),
        );
        controller.enqueue(enc.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });
    globalThis.fetch = (async () =>
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'request-id': 'req_mock_1',
          'anthropic-organization-id': 'org_mock',
        },
      })) as unknown as typeof fetch;
    try {
      const cfg = loadRuntimeConfig(baseEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }));
      const result = await runProof({ challengeId: 'abc-123' }, cfg);
      expect(result.mode).toBe('byo-key');
      expect(result.respondedModel).toBe('claude-opus-4-7');
      expect(result.streamedText).toContain('echo-abc-123');
      expect(result.responseHeaders['request-id']).toBe('req_mock_1');
      expect(result.requestHeaders['x-api-key']).toBe('REDACTED');
      expect(result.sseChunks.length).toBeGreaterThanOrEqual(3);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
