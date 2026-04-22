// Thin compatibility shim. The real bridge probe lives in ./local-oauth-bridge.
// Older callers expected a "is the claude binary on the path" informational
// response; we now return real bridge readiness instead, because Maxbridge
// DOES bridge to the local CLI on this machine.

import { loadRuntimeConfig } from './config.js';
import { probeLocalBridge } from './local-oauth-bridge.js';

export interface CliBridgeProbe {
  claudeBinaryDetected: boolean;
  claudeVersion: string | null;
  loggedIn: boolean;
  authMethod: string | null;
  provider: string | null;
  state: 'ready' | 'cli-missing' | 'cli-not-logged-in' | 'unknown';
  sameMachineOnly: true;
  portable: false;
  note: string;
}

export async function probeClaudeCli(): Promise<CliBridgeProbe> {
  const cfg = loadRuntimeConfig();
  const probe = await probeLocalBridge(cfg);
  return {
    claudeBinaryDetected: probe.claudeBinaryDetected,
    claudeVersion: probe.claudeVersion,
    loggedIn: probe.loggedIn,
    authMethod: probe.authMethod,
    provider: probe.provider,
    state: probe.state,
    sameMachineOnly: true,
    portable: false,
    note: probe.note,
  };
}

export const cliBridgeNote =
  'Proven on THIS Mac only: same user, same machine, same keychain. Not portable.';
