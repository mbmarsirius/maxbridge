import { loadRuntimeConfig, describeProxyMode } from './config.js';
import { startProxyServer } from './proxy.js';
import { probeLocalBridge } from './local-oauth-bridge.js';
import { ensureFriendTrialLicense, licenseFilePath, startOnlineLicensePoller } from './license/index.js';

const VERSION = '0.1.0-alpha.2';

async function banner(): Promise<void> {
  const cfg = loadRuntimeConfig();
  const mode = describeProxyMode(cfg);
  const probe = await probeLocalBridge(cfg);
  const line = '='.repeat(60);
  console.log(line);
  console.log(`Maxbridge proxy ${VERSION}`);
  console.log(`  endpoint:         http://${cfg.bind}:${cfg.port}`);
  console.log(`  preferred mode:   ${mode.toUpperCase()}`);
  console.log(`  default model:    ${cfg.defaultModel}`);
  console.log(`  telemetry:        off`);
  console.log(line);
  console.log('Auth backends (in priority order):');
  console.log(`  1. local-oauth    ${probe.state === 'ready' ? 'READY' : 'NOT READY'} (${probe.note})`);
  console.log(`     claude binary: ${probe.claudeBinaryDetected ? (probe.claudeVersion ?? 'detected') : 'missing'}`);
  console.log(`     logged in:     ${probe.loggedIn ? 'yes' : 'no'} (authMethod=${probe.authMethod ?? 'n/a'})`);
  console.log(`  2. byo-key        ${cfg.anthropicApiKey ? 'configured (env)' : 'not set'}  [fallback/dev mode]`);
  console.log(`  3. stub           always available (no live call)`);
  console.log(line);
  console.log('Routes:');
  console.log('  GET  /healthz');
  console.log('  GET  /v1/status');
  console.log('  GET  /v1/local-bridge      (local Claude CLI OAuth readiness)');
  console.log('  POST /v1/proof             { challengeId, model? }');
  console.log('  POST /v1/messages          (Anthropic passthrough — BYO key only today)');
  console.log('  POST /v1/chat/completions  (not implemented in V0.1)');
  console.log(line);
  console.log('Honesty:');
  console.log('  Proven on THIS Mac: same-user, same-machine OAuth bridge → claude-opus-4-7.');
  console.log('  Not proven: portable / reusable / friend-install OAuth. See AUTH_REALITY.md.');
  console.log(line);
}

async function main(): Promise<void> {
  // First-run friend-install trial: if no license file exists on disk, write
  // a 365-day local trial so non-technical testers reach the proof screen
  // without signing up or entering a key. Idempotent — never extends an
  // existing license. Set MAXBRIDGE_AUTO_TRIAL=0 to disable.
  const trialState = ensureFriendTrialLicense();
  if (trialState === 'provisioned') {
    console.log(`[maxbridge-license] Auto-provisioned a friend-install trial (365 days). License file: ${licenseFilePath()}`);
  } else if (trialState === 'disabled') {
    console.log('[maxbridge-license] Auto-trial disabled via MAXBRIDGE_AUTO_TRIAL=0 — proxy will require an explicit license.');
  }
  await banner();
  const { server, cfg } = startProxyServer({ version: VERSION });
  server.on('error', (err) => {
    console.error(`[maxbridge] server error: ${(err as Error).message}`);
    process.exit(1);
  });

  // Kick off the 6h online license poller. It's a no-op unless the user is
  // on a paid subscription — trial and lifetime states never touch the
  // network — but when it matters, it catches lapsed/revoked licenses
  // within hours rather than waiting out the JWT's own expiry.
  const poller = startOnlineLicensePoller();

  const shutdown = (signal: string) => () => {
    console.log(`\n[maxbridge] received ${signal}, shutting down`);
    poller.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
  console.log(`[maxbridge] listening on http://${cfg.bind}:${cfg.port}`);
}

void main();
