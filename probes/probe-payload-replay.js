'use strict';
// Probe T1 (replay) + T6 (mismatch diagnostics) against the Payload x402 kit
// example server. Starts the example server on an ephemeral port with the dev
// verifier, then:
//   T1: mints a payment, submits it twice (fresh 402 challenge each time),
//       records whether the second submit is accepted.
//   T6: submits payments with wrong amount / wrong asset / wrong network,
//       records the 402 body `reason` for each.
// Usage: node probe-payload-replay.js
// Requires: the kit extracted at /tmp/x402bench (see README reproduce steps).

const { spawn } = require('child_process');
const path = require('path');

const KIT = '/tmp/x402bench';
const SECRET = 'bench-secret-' + Date.now();
const PORT = 3497;

const core = require(path.join(KIT, 'x402-core'));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(KIT, 'example', 'server.js'), String(PORT)], {
      env: { ...process.env, X402_DEV_SECRET: SECRET, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.includes('listening on')) resolve(child); });
    child.stderr.on('data', (d) => { out += d; });
    setTimeout(() => reject(new Error('server did not start. Output:\n' + out)), 15000);
    child.on('error', reject);
  });
}

async function req(p, headers = {}) {
  const res = await fetch(`http://localhost:${PORT}${p}`, { headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, headers: res.headers, json, text };
}

(async () => {
  const child = await startServer();
  const results = {};
  try {
    // ---- T1: replay -------------------------------------------------------
    const c1 = await req('/api/joke');
    const reqs1 = core.decodeRequirements(c1.headers.get('payment-required'));
    const verifier = core.createDevVerifier({ secret: SECRET });
    const payment = verifier.mintPayment(reqs1);
    const enc = core.encodePaymentPayload(payment);

    const first = await req('/api/joke', { 'x-payment': enc });
    // Fresh challenge (new nonce), replay the SAME payment payload bytes.
    const c2 = await req('/api/joke');
    const reqs2 = core.decodeRequirements(c2.headers.get('payment-required'));
    const second = await req('/api/joke', { 'x-payment': enc });

    results.t1_replay = {
      first_status: first.status,
      second_status: second.status,
      nonce1: reqs1.nonce,
      nonce2: reqs2.nonce,
      nonces_differ: reqs1.nonce !== reqs2.nonce,
      verdict: second.status === 200
        ? 'REPLAY ACCEPTED: same payment payload accepted against a fresh nonce'
        : 'replay rejected',
    };

    // ---- T6: mismatch diagnostics -----------------------------------------
    const c3 = await req('/api/quote');
    const reqs3 = core.decodeRequirements(c3.headers.get('payment-required'));
    const v = core.createDevVerifier({ secret: SECRET });

    const cases = {
      wrong_amount: { ...v.mintPayment(reqs3), amount: '0.000001' },
      wrong_asset: { ...v.mintPayment(reqs3), asset: 'USDT' },
      wrong_network: { ...v.mintPayment(reqs3), network: 'ethereum' },
      wrong_payTo: { ...v.mintPayment(reqs3), payTo: '0xattacker' },
    };
    // re-sign each tampered payload so the signature itself stays valid
    const { createHmac } = require('crypto');
    const resign = (p) => {
      p.sig = createHmac('sha256', SECRET)
        .update([p.txHash, p.from, p.amount, p.asset, p.network, p.payTo].join('|')).digest('hex');
      return p;
    };
    results.t6_mismatch = {};
    for (const [name, p] of Object.entries(cases)) {
      const r = await req('/api/quote', { 'x-payment': core.encodePaymentPayload(resign(p)) });
      results.t6_mismatch[name] = { status: r.status, reason: r.json && r.json.reason };
    }
    // structured expected-vs-actual?
    results.t6_mismatch.structured_expected_actual_fields =
      !!((await req('/api/quote', { 'x-payment': core.encodePaymentPayload(resign(cases.wrong_amount)) })).json || {}).expectedAmount;

    console.log(JSON.stringify(results, null, 2));
  } finally {
    child.kill();
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
