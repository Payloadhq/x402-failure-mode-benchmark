'use strict';
// Probe T2 (402 completeness) + T3 (manifest parity) + T7 (ledger append-only)
// against the Payload x402 kit example server (dev verifier).
// Usage: node probe-payload-surface.js

const { spawn } = require('child_process');
const path = require('path');

const KIT = '/tmp/x402bench';
const SECRET = 'bench-secret-' + Date.now();
const PORT = 3498;
const core = require(path.join(KIT, 'x402-core'));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(KIT, 'example', 'server.js'), String(PORT)], {
      env: { ...process.env, X402_DEV_SECRET: SECRET, PORT: String(PORT), X402_LEDGER_FILE: '/tmp/x402bench-ledger-test.jsonl' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.includes('listening on')) resolve(child); });
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
    // ---- T2: 402 completeness ---------------------------------------------
    const r402 = await req('/api/joke');
    const hdr = r402.headers.get('payment-required');
    const decoded = hdr ? core.decodeRequirements(hdr) : null;
    results.t2_402 = {
      status: r402.status,
      header_present: !!hdr,
      body_error: r402.json && r402.json.error,
      body_paymentRequirements_present: !!(r402.json && r402.json.paymentRequirements),
      fields: decoded ? {
        price_amount: decoded.amount,
        asset: decoded.asset,
        network: decoded.network,
        payTo: decoded.payTo,
        expiry_expiresAt: decoded.expiresAt,
        nonce: decoded.nonce,
        all_six_present: ['amount','asset','network','payTo','expiresAt','nonce'].every(k => decoded[k] !== undefined),
      } : null,
    };

    // ---- T3: manifest parity ----------------------------------------------
    const man = await req('/.well-known/x402');
    const parity = [];
    if (man.status === 200 && man.json && Array.isArray(man.json.endpoints)) {
      for (const e of man.json.endpoints) {
        const live = await req(e.path);
        const liveReqs = live.headers.get('payment-required')
          ? core.decodeRequirements(live.headers.get('payment-required')) : null;
        parity.push({
          path: e.path,
          manifest_price: e.price,
          enforced_price: liveReqs ? liveReqs.amount : null,
          match: liveReqs ? String(e.price) === String(liveReqs.amount) : false,
        });
      }
    }
    results.t3_manifest = {
      manifest_status: man.status,
      endpoints: parity,
      all_match: parity.length > 0 && parity.every(p => p.match),
    };

    // ---- T7: ledger append-only --------------------------------------------
    const v = core.createDevVerifier({ secret: SECRET });
    const fs = require('fs');
    const before = await req('/api/ledger');
    const n0 = before.json.paidCalls;
    for (let i = 0; i < 2; i++) {
      const c = await req('/api/joke');
      const rq = core.decodeRequirements(c.headers.get('payment-required'));
      await req('/api/joke', { 'x-payment': core.encodePaymentPayload(v.mintPayment(rq)) });
    }
    const after = await req('/api/ledger');
    results.t7_ledger = {
      entries_before: n0,
      entries_after: after.json.paidCalls,
      grew_by_two: after.json.paidCalls === n0 + 2,
      ledger_endpoint_present: true,
      jsonl_file_exists: fs.existsSync(path.join(KIT, 'data', 'ledger.jsonl')),
    };
    // verify append-only: file lines are all valid JSON, never rewritten
    try {
      const lines = fs.readFileSync(path.join(KIT, 'data', 'ledger.jsonl'), 'utf8').trim().split('\n');
      results.t7_ledger.jsonl_lines = lines.length;
      results.t7_ledger.jsonl_all_parse = lines.every(l => { JSON.parse(l); return true; });
    } catch (e) { results.t7_ledger.jsonl_error = e.message; }

    console.log(JSON.stringify(results, null, 2));
  } finally {
    child.kill();
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
