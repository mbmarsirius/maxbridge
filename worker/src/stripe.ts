// Stripe webhook signature verification + event dispatch.
//
// Runs inside a Cloudflare Worker, so we use Web Crypto instead of the Node
// `crypto` module. The signature scheme is Stripe's v1 HMAC-SHA256 over
// "<timestamp>.<raw body>", keyed by the webhook signing secret.
//
// We only act on three events:
//   1. checkout.session.completed   →  new subscription: mint JWT + email
//   2. invoice.paid                 →  renewal: refresh JWT exp
//   3. customer.subscription.deleted → lapsed: mark status=lapsed
//
// Everything else is ACK'd with 200 so Stripe stops retrying.

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verify the `Stripe-Signature` header against the raw request body.
 *
 * Tolerance: 5 minutes (matches Stripe's recommended default). Older events
 * are rejected — avoids replay attacks if a webhook log leaks.
 */
export async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSec = 5 * 60,
): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = sigHeader.split(',').map((p) => p.trim());
  let ts: number | null = null;
  const v1Signatures: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split('=', 2);
    if (k === 't') ts = Number(v);
    if (k === 'v1' && v) v1Signatures.push(v);
  }
  if (!ts || v1Signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const msg = `${ts}.${rawBody}`;
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  const expected = toHex(new Uint8Array(mac));

  // constant-time compare against all v1 signatures
  return v1Signatures.some((sig) => timingSafeEqualHex(sig, expected));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface CheckoutCompleted {
  subscriptionId: string;
  customerId: string;
  email: string;
  metadata: Record<string, string>;
}

export function parseCheckoutCompleted(evt: StripeEvent): CheckoutCompleted | null {
  if (evt.type !== 'checkout.session.completed') return null;
  const session = evt.data.object as Record<string, unknown>;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
  const customerId = typeof session.customer === 'string' ? session.customer : null;
  const details = (session.customer_details as Record<string, unknown>) ?? {};
  const email = (typeof details.email === 'string' && details.email)
    || (typeof session.customer_email === 'string' && session.customer_email)
    || null;
  const metadata = (session.metadata as Record<string, string>) ?? {};
  if (!subscriptionId || !customerId || !email) return null;
  return { subscriptionId, customerId, email, metadata };
}

export interface InvoicePaid {
  subscriptionId: string;
  periodEnd: number;
}

export function parseInvoicePaid(evt: StripeEvent): InvoicePaid | null {
  if (evt.type !== 'invoice.paid') return null;
  const inv = evt.data.object as Record<string, unknown>;
  const subscriptionId = typeof inv.subscription === 'string' ? inv.subscription : null;
  const lines = (inv.lines as { data?: Array<{ period?: { end?: number } }> }) ?? {};
  const periodEnd = lines.data?.[0]?.period?.end ?? null;
  if (!subscriptionId || !periodEnd) return null;
  return { subscriptionId, periodEnd };
}

export interface SubscriptionDeleted {
  subscriptionId: string;
}

export function parseSubscriptionDeleted(evt: StripeEvent): SubscriptionDeleted | null {
  if (evt.type !== 'customer.subscription.deleted') return null;
  const sub = evt.data.object as Record<string, unknown>;
  const id = typeof sub.id === 'string' ? sub.id : null;
  if (!id) return null;
  return { subscriptionId: id };
}
