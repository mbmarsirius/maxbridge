import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyStripeSignature,
  parseCheckoutCompleted,
  parseInvoicePaid,
  parseSubscriptionDeleted,
} from '../src/stripe.js';

/**
 * Build a Stripe-style signature header for a raw body.
 *
 * See https://stripe.com/docs/webhooks/signatures#verify-manually. The header
 * is `t=<timestamp>,v1=<hex_hmac>,v1=<another_hex_hmac>...`.
 */
function sign(rawBody: string, secret: string, tsSec: number): string {
  const mac = createHmac('sha256', secret)
    .update(`${tsSec}.${rawBody}`)
    .digest('hex');
  return `t=${tsSec},v1=${mac}`;
}

const SECRET = 'whsec_test_123';

describe('verifyStripeSignature', () => {
  it('accepts a correctly signed body within tolerance', async () => {
    const body = '{"id":"evt_1","type":"checkout.session.completed"}';
    const ts = Math.floor(Date.now() / 1000);
    const ok = await verifyStripeSignature(body, sign(body, SECRET, ts), SECRET, Date.now());
    expect(ok).toBe(true);
  });

  it('rejects when the body was tampered with after signing', async () => {
    const body = '{"id":"evt_1"}';
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign(body, SECRET, ts);
    const ok = await verifyStripeSignature(body + ' ', sig, SECRET, Date.now());
    expect(ok).toBe(false);
  });

  it('rejects when signature is older than tolerance', async () => {
    const body = '{}';
    const oldTs = Math.floor(Date.now() / 1000) - 10 * 60;
    const ok = await verifyStripeSignature(body, sign(body, SECRET, oldTs), SECRET, Date.now());
    expect(ok).toBe(false);
  });

  it('rejects with the wrong secret', async () => {
    const body = '{}';
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign(body, SECRET, ts);
    const ok = await verifyStripeSignature(body, sig, 'whsec_wrong', Date.now());
    expect(ok).toBe(false);
  });
});

describe('event parsers', () => {
  it('parseCheckoutCompleted extracts sub+customer+email', () => {
    const evt = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          subscription: 'sub_123',
          customer: 'cus_456',
          customer_details: { email: 'buyer@example.com' },
          metadata: { campaign: 'launch' },
        },
      },
    };
    const out = parseCheckoutCompleted(evt);
    expect(out).toEqual({
      subscriptionId: 'sub_123',
      customerId: 'cus_456',
      email: 'buyer@example.com',
      metadata: { campaign: 'launch' },
    });
  });

  it('parseCheckoutCompleted falls back to customer_email', () => {
    const evt = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          subscription: 'sub_123',
          customer: 'cus_456',
          customer_email: 'legacy@example.com',
        },
      },
    };
    expect(parseCheckoutCompleted(evt)?.email).toBe('legacy@example.com');
  });

  it('parseInvoicePaid extracts subscription + period end', () => {
    const evt = {
      id: 'evt_2',
      type: 'invoice.paid',
      data: {
        object: {
          subscription: 'sub_789',
          lines: { data: [{ period: { end: 1800000000 } }] },
        },
      },
    };
    expect(parseInvoicePaid(evt)).toEqual({ subscriptionId: 'sub_789', periodEnd: 1800000000 });
  });

  it('parseSubscriptionDeleted extracts the id', () => {
    const evt = {
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_abc' } },
    };
    expect(parseSubscriptionDeleted(evt)).toEqual({ subscriptionId: 'sub_abc' });
  });

  it('returns null for non-matching event types', () => {
    const evt = { id: 'evt_x', type: 'ping', data: { object: {} } };
    expect(parseCheckoutCompleted(evt)).toBeNull();
    expect(parseInvoicePaid(evt)).toBeNull();
    expect(parseSubscriptionDeleted(evt)).toBeNull();
  });
});
