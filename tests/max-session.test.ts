import { describe, expect, it } from 'vitest';
import {
  applyProxyStatus,
  beginMaxLogin,
  createInitialSessionState,
  markConnected,
  markSessionError,
} from '../bridge/max-session';

describe('max-session bridge', () => {
  it('starts idle in stub mode with the reserved localhost endpoint', () => {
    const state = createInitialSessionState();
    expect(state.status).toBe('idle');
    expect(state.mode).toBe('stub');
    expect(state.endpoint).toBe('http://127.0.0.1:7423');
    expect(state.keyPresent).toBe(false);
    expect(state.localBridgeReady).toBe(false);
    expect(state.source).toBe('stub');
  });

  it('refuses cross-machine Claude Max login and explains the honest reason', async () => {
    const result = await beginMaxLogin();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/sanctioned/i);
    expect(result.message).toMatch(/cookie-scrape|fake/i);
    expect(result.state.mode).toBe('max-cross-machine');
    expect(result.state.status).toBe('error');
  });

  it('promotes session to local-oauth when the proxy reports the bridge is ready', () => {
    const next = applyProxyStatus(createInitialSessionState(), {
      endpoint: 'http://127.0.0.1:7423',
      mode: 'local-oauth',
      defaultModel: 'claude-opus-4-7',
      keySource: 'none',
      authReality: {
        activeAuth: 'local-oauth',
        localOauthBridge: {
          state: 'ready',
          loggedIn: true,
          authMethod: 'oauth_token',
          provider: 'firstParty',
        },
      },
    });
    expect(next.status).toBe('connected');
    expect(next.mode).toBe('local-oauth');
    expect(next.localBridgeReady).toBe(true);
    expect(next.accountLabel).toMatch(/Local Claude CLI OAuth/i);
    expect(next.source).toBe('proxy-status');
  });

  it('promotes session to byo-key when the proxy reports an env-backed key', () => {
    const next = applyProxyStatus(createInitialSessionState(), {
      endpoint: 'http://127.0.0.1:7423',
      mode: 'byo-key',
      defaultModel: 'claude-opus-4-7',
      keySource: 'env',
    });
    expect(next.status).toBe('connected');
    expect(next.mode).toBe('byo-key');
    expect(next.keyPresent).toBe(true);
    expect(next.accountLabel).toMatch(/BYO/);
    expect(next.source).toBe('proxy-status');
  });

  it('falls back to stub when the proxy reports no auth', () => {
    const next = applyProxyStatus(createInitialSessionState(), {
      endpoint: 'http://127.0.0.1:7423',
      mode: 'stub',
      defaultModel: 'claude-opus-4-7',
      keySource: 'none',
    });
    expect(next.status).toBe('idle');
    expect(next.mode).toBe('stub');
    expect(next.keyPresent).toBe(false);
    expect(next.localBridgeReady).toBe(false);
  });

  it('captures session errors for the UI', () => {
    const err = markSessionError('no proxy');
    expect(err.status).toBe('error');
    expect(err.lastError).toBe('no proxy');
  });

  it('markConnected sets expected label and mode', () => {
    const conn = markConnected('BYO Anthropic key (env)');
    expect(conn.status).toBe('connected');
    expect(conn.mode).toBe('byo-key');
    expect(conn.keyPresent).toBe(true);
  });
});
