// Typed KV wrappers.
//
// Two namespaces live in a single KV binding with key prefixes:
//   "license:<jti>"          LicenseRecord
//   "download_token:<t>"     DownloadToken
//   "stripe_sub:<sub_id>"    StripeSubRef (reverse lookup: Stripe sub id → jti)

export interface LicenseRecord {
  jti: string;
  email: string;
  plan: 'monthly' | 'lifetime' | 'trial';
  issuedAt: string;
  expiresAt: string;
  graceUntil: string;
  lastRenewedAt?: string;
  activations: Array<{ deviceId: string; at: string; ip?: string }>;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status: 'active' | 'lapsed' | 'revoked';
}

export interface DownloadToken {
  jti: string;
  createdAt: string;
  usedAt?: string;
}

export interface StripeSubRef {
  jti: string;
  email: string;
}

export class LicenseKv {
  constructor(private readonly kv: KVNamespace) {}

  async putLicense(r: LicenseRecord): Promise<void> {
    await this.kv.put(`license:${r.jti}`, JSON.stringify(r));
    if (r.stripeSubscriptionId) {
      await this.kv.put(
        `stripe_sub:${r.stripeSubscriptionId}`,
        JSON.stringify({ jti: r.jti, email: r.email } satisfies StripeSubRef),
      );
    }
  }

  async getLicense(jti: string): Promise<LicenseRecord | null> {
    const raw = await this.kv.get(`license:${jti}`, 'text');
    return raw ? (JSON.parse(raw) as LicenseRecord) : null;
  }

  async getLicenseByStripeSubscription(subId: string): Promise<LicenseRecord | null> {
    const ref = await this.kv.get(`stripe_sub:${subId}`, 'text');
    if (!ref) return null;
    const { jti } = JSON.parse(ref) as StripeSubRef;
    return this.getLicense(jti);
  }

  async putDownloadToken(token: string, rec: DownloadToken): Promise<void> {
    // TTL 30 days — the download link expires; after that the user can still
    // recover by logging into the customer portal (future feature).
    await this.kv.put(`download_token:${token}`, JSON.stringify(rec), {
      expirationTtl: 30 * 24 * 60 * 60,
    });
  }

  async getDownloadToken(token: string): Promise<DownloadToken | null> {
    const raw = await this.kv.get(`download_token:${token}`, 'text');
    return raw ? (JSON.parse(raw) as DownloadToken) : null;
  }
}

/**
 * Short url-safe token for download links. ~144 bits.
 */
export function generateDownloadToken(): string {
  const buf = new Uint8Array(18);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
