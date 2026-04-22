import { describe, it, expect } from 'vitest';
import {
  initialWizardState,
  reducer,
  MAX_LOGIN_POLL,
  type WizardState,
} from '../src/wizard/lib/state';
import type {
  CliBridgeProbe,
  OpenClawDetectResponse,
  OpenClawInstallResult,
} from '../src/wizard/lib/bridge-client';

function probe(over: Partial<CliBridgeProbe> = {}): CliBridgeProbe {
  return {
    claudeBinaryDetected: true,
    claudeVersion: '1.0.0',
    loggedIn: true,
    authMethod: 'oauth_token',
    provider: 'anthropic',
    state: 'ready',
    sameMachineOnly: true,
    portable: false,
    note: '',
    ...over,
  };
}

describe('wizard reducer', () => {
  it('start: moves welcome → check-cli and clears any error', () => {
    const s: WizardState = { ...initialWizardState, error: 'x' };
    const next = reducer(s, { type: 'start' });
    expect(next.step).toBe('check-cli');
    expect(next.error).toBeNull();
  });

  it('probe with CLI missing → cli-missing', () => {
    const next = reducer(initialWizardState, {
      type: 'cli/probe-result',
      probe: probe({ claudeBinaryDetected: false, state: 'cli-missing', loggedIn: false }),
    });
    expect(next.step).toBe('cli-missing');
  });

  it('probe null (timeout) → cli-missing (never stall)', () => {
    const next = reducer(initialWizardState, { type: 'cli/probe-result', probe: null });
    expect(next.step).toBe('cli-missing');
    expect(next.cliProbe).toBeNull();
  });

  it('probe with CLI but not logged in → need-login', () => {
    const next = reducer(initialWizardState, {
      type: 'cli/probe-result',
      probe: probe({ loggedIn: false, state: 'cli-not-logged-in' }),
    });
    expect(next.step).toBe('need-login');
  });

  it('probe with CLI and logged in → integrations, resets login poll', () => {
    const starting: WizardState = { ...initialWizardState, loginPollAttempts: 7 };
    const next = reducer(starting, { type: 'cli/probe-result', probe: probe() });
    expect(next.step).toBe('integrations');
    expect(next.loginPollAttempts).toBe(0);
  });

  it('recheck after user installs CLI → check-cli, clears error', () => {
    const s: WizardState = { ...initialWizardState, step: 'cli-missing', error: 'x' };
    const next = reducer(s, { type: 'cli/recheck' });
    expect(next.step).toBe('check-cli');
    expect(next.error).toBeNull();
  });

  it('login poll tick only increments on need-login', () => {
    const integrations: WizardState = { ...initialWizardState, step: 'integrations' };
    expect(reducer(integrations, { type: 'login/poll-tick' }).loginPollAttempts).toBe(0);
    const login: WizardState = { ...initialWizardState, step: 'need-login' };
    expect(reducer(login, { type: 'login/poll-tick' }).loginPollAttempts).toBe(1);
  });

  it('login poll resets back to 0 after exceeding MAX_LOGIN_POLL attempts', () => {
    const s: WizardState = {
      ...initialWizardState,
      step: 'need-login',
      loginPollAttempts: MAX_LOGIN_POLL,
    };
    const next = reducer(s, { type: 'login/poll-tick' });
    expect(next.loginPollAttempts).toBe(0);
  });

  it('integrations/skip jumps directly to success', () => {
    const s: WizardState = { ...initialWizardState, step: 'integrations' };
    expect(reducer(s, { type: 'integrations/skip' }).step).toBe('success');
  });

  it('openclaw install success sets toast and marks connected', () => {
    const detect: OpenClawDetectResponse = {
      installed: true,
      configPath: '/x/openclaw.json',
      configExists: true,
      configValid: true,
      providers: ['maxbridge'],
      hasMaxbridgeProvider: true,
      hasMaxbridgeAsPrimary: false,
      agents: [],
      detectedAt: new Date().toISOString(),
    };
    const starting: WizardState = {
      ...initialWizardState,
      step: 'integrations',
      openclaw: detect,
      surface: { kind: 'openclaw-connect' },
    };
    const result: OpenClawInstallResult = {
      ok: true,
      changed: true,
      backupPath: '/x/bak',
      steps: ['wrote'],
    };
    const next = reducer(starting, { type: 'openclaw/installed', result });
    // On success, the modal intentionally stays open so the user sees the
    // "Restart gateway now" action. Connection flag and result snapshot flip;
    // error is cleared.
    expect(next.surface.kind).toBe('openclaw-connect');
    expect(next.connected.openclaw).toBe(true);
    expect(next.lastOpenClawResult).toEqual(result);
    expect(next.error).toBeNull();
  });

  it('openclaw install failure sets error, does not mark connected', () => {
    const starting: WizardState = {
      ...initialWizardState,
      step: 'integrations',
      surface: { kind: 'openclaw-connect' },
    };
    const next = reducer(starting, {
      type: 'openclaw/installed',
      result: { ok: false, changed: false, steps: [], reason: 'nope' },
    });
    expect(next.connected.openclaw).toBe(false);
    expect(next.error).toBe('nope');
    expect(next.toast).toBeNull();
  });

  it('manual drawer: open then close toggles surface cleanly', () => {
    const base: WizardState = { ...initialWizardState, step: 'integrations' };
    const opened = reducer(base, { type: 'manual/open', app: 'cursor' });
    expect(opened.surface).toEqual({ kind: 'manual-drawer', app: 'cursor' });
    const closed = reducer(opened, { type: 'manual/close' });
    expect(closed.surface.kind).toBe('none');
  });

  it('minimize → menu-bar, restore → success', () => {
    const s: WizardState = { ...initialWizardState, step: 'success' };
    const mini = reducer(s, { type: 'minimize' });
    expect(mini.step).toBe('menu-bar');
    const restored = reducer(mini, { type: 'restore' });
    expect(restored.step).toBe('success');
  });

  it('error set/clear + toast set/clear round-trip', () => {
    const withErr = reducer(initialWizardState, { type: 'error/set', message: 'boom' });
    expect(withErr.error).toBe('boom');
    const cleared = reducer(withErr, { type: 'error/clear' });
    expect(cleared.error).toBeNull();

    const withToast = reducer(initialWizardState, { type: 'toast/set', message: 'hi' });
    expect(withToast.toast).toBe('hi');
    expect(reducer(withToast, { type: 'toast/clear' }).toast).toBeNull();
  });
});
