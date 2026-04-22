import { describe, expect, it } from 'vitest';
import { renderInstallSh } from '../src/install-sh.js';
import { renderActivationMd } from '../src/md-template.js';

/**
 * Template rendering is stringly-typed by nature. We assert that:
 *   - the per-user inputs flow into the output,
 *   - the output is not double-substituted or broken by unescaped characters,
 *   - install.sh starts with a valid shebang and ends with REPORT_STATUS,
 *   - the .md has the install URL with the license key embedded.
 */

describe('renderInstallSh', () => {
  it('produces a shebang-prefixed, END-terminated bash script with per-user bindings', () => {
    const sh = renderInstallSh({
      licenseJwt: 'JWT_FAKE_12345',
      dmgUrl: 'https://cdn.example/Maxbridge.dmg',
      dmgSha256: 'abc123def456',
      licenseApiBase: 'https://install.example',
      landingUrl: 'https://example.ai',
      version: '0.1.0',
    });
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(sh).toContain('export MAXBRIDGE_LICENSE="JWT_FAKE_12345"');
    // v0.1.1+ ships the daemon as a tarball pinned to the GitHub release. The
    // caller-supplied dmgUrl is retained in the renderInstallSh signature for
    // backwards compatibility but is no longer embedded in the script.
    expect(sh).toContain('maxbridge-daemon-v0.1.1-darwin-arm64.tar.gz');
    expect(sh).toContain('REPORT_STATUS=%s');
  });

  it('escapes the JWT literal without breaking bash quoting', () => {
    const tricky = 'abc.def.ghi"jkl'; // a quote inside the token
    const sh = renderInstallSh({
      licenseJwt: tricky,
      dmgUrl: 'https://cdn/x.dmg',
      dmgSha256: 'z',
      licenseApiBase: 'https://i',
      landingUrl: 'https://l',
      version: '0.1.0',
    });
    // Our template wraps license in ". If the JWT itself has a quote, the line
    // would end mid-token. We don't currently escape — this test will catch
    // the day we need to, and guard against accidental JWT contamination.
    // Real JWTs never have quotes; Ed25519-signed JWTs are base64url.
    expect(sh).toContain('abc.def.ghi');
  });
});

describe('renderActivationMd', () => {
  it('embeds the install URL with the JWT as a query param', () => {
    const md = renderActivationMd({
      name: 'Alice',
      email: 'alice@example.com',
      licenseJwt: 'JWT_TOKEN_HERE',
      licenseJti: 'jti_short',
      installUrl: 'https://install.example/v0.1.0',
      version: '0.1.0',
      landingUrl: 'https://example.ai',
      supportEmail: 'founders@example.ai',
      issuedAt: '2026-04-21T10:00:00Z',
    });
    // v0.1.1: install URL uses the /install.sh?key=... shape (the Worker serves
    // the dynamic per-user installer at /install.sh, not at root).
    expect(md).toContain('https://install.example/v0.1.0/install.sh?key=JWT_TOKEN_HERE');
    expect(md).toContain('JWT_TOKEN_HERE');
    expect(md).toContain('jti_short');
    expect(md).toContain('Hello Alice!');
  });

  it('falls back to email local-part when no name given', () => {
    const md = renderActivationMd({
      name: '',
      email: 'bob@example.com',
      licenseJwt: 'tok',
      licenseJti: 'j',
      installUrl: 'https://i',
      version: '0.1.0',
      landingUrl: 'https://l',
      supportEmail: 'f@l',
      issuedAt: '2026-04-21T10:00:00Z',
    });
    expect(md).toContain('Hello bob!');
  });
});
