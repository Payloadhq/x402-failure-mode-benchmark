'use strict';
// Probes against x402-hono v1.2.0 (live fixture on port 3411).
//   T2: 402 completeness — fields in accepts[]
//   T3: manifest — GET /.well-known/x402
//   T6: mismatch diagnostics — malformed X-PAYMENT, and a well-formed EIP-3009
//       payload with the WRONG amount (no on-chain payment is made; the
//       middleware rejects before contacting any facilitator)
// Usage: node probe-hono.js
// Requires: fixture running (node .bench-env/hono/hono-server.js 3411)

const BASE = 'http://localhost:3411';

async function get(p, headers = {}) {
  const res = await fetch(BASE + p, { headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text };
}

(async () => {
  const results = {};

  // ---- T2: 402 completeness -----------------------------------------------
  const r402 = await get('/protected');
  const a = r402.json && r402.json.accepts && r402.json.accepts[0];
  results.t2_402 = {
    status: r402.status,
    body_error: r402.json && r402.json.error,
    fields: a ? {
      price_maxAmountRequired: a.maxAmountRequired,
      asset: a.asset,
      network: a.network,
      payTo: a.payTo,
      expiry_maxTimeoutSeconds: a.maxTimeoutSeconds,
      nonce_field_present: 'nonce' in a,
    } : null,
  };

  // ---- T3: manifest ----------------------------------------------------------
  const man = await get('/.well-known/x402');
  results.t3_manifest = { status: man.status, has_manifest: man.status === 200 };

  // ---- T6: mismatch diagnostics ---------------------------------------------
  const malformed = await get('/protected', { 'x-payment': 'not-valid-base64!!!' });
  results.t6_malformed = { status: malformed.status, error: malformed.json && malformed.json.error };

  // Well-formed EIP-3009 payload, wrong amount: NOT tested live. Code inspection
  // of x402-hono v1.2.0 shows findMatchingPaymentRequirements() matches on
  // scheme + network ONLY (x402/dist/cjs/shared/index.js) — amount validation
  // is delegated to the facilitator /verify call, which requires a live
  // facilitator and (for a real verdict) an on-chain payment. Attempting it
  // here would issue a real network call to the default facilitator.
  results.t6_wrong_amount = {
    tested: 'code inspection only',
    finding: 'middleware matches requirements on scheme+network only; amount ' +
      'checked by facilitator /verify, not the middleware',
  };

  console.log(JSON.stringify(results, null, 2));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
