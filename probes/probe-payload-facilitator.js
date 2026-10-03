'use strict';
// Probe T4 (facilitator failure mode) for the Payload x402 kit.
// Wires paidRoute with createFacilitatorVerifier pointed at:
//   (a) a closed port (connection refused)
//   (b) a server that accepts the connection and never responds (hang)
// Records: HTTP status returned to the client (fail open = 200, fail closed = 402)
// and elapsed time (verifies the timeout is honored).
// Usage: node probe-payload-facilitator.js

const http = require('http');
const express = require('/tmp/x402bench/node_modules/express');
const core = require('/tmp/x402bench/x402-core');
const { paidRoute } = require('/tmp/x402bench/express-middleware');

async function main() {
  const results = {};

  // (b) hanging server: accepts, never responds
  const hang = http.createServer(() => { /* never respond */ });
  await new Promise((r) => hang.listen(3499, r));

  const app = express();
  const closedVerifier = core.createFacilitatorVerifier({ verifyUrl: 'http://127.0.0.1:9/verify', timeoutMs: 3000 });
  const hangVerifier = core.createFacilitatorVerifier({ verifyUrl: 'http://127.0.0.1:3499/verify', timeoutMs: 3000 });
  app.get('/closed',
    paidRoute({ price: '0.01', payTo: '0xabc', network: 'base', asset: 'USDC', verifier: closedVerifier }),
    (req, res) => res.json({ served: true }));
  app.get('/hang',
    paidRoute({ price: '0.01', payTo: '0xabc', network: 'base', asset: 'USDC', verifier: hangVerifier }),
    (req, res) => res.json({ served: true }));
  const server = app.listen(3500);
  await new Promise((r) => setTimeout(r, 500));

  const fakePayment = Buffer.from(JSON.stringify({ txHash: '0x1', from: '0xa', sig: 'x' })).toString('base64');

  for (const [name, route] of [['closed_port', '/closed'], ['hanging_facilitator', '/hang']]) {
    const t0 = Date.now();
    const res = await fetch(`http://localhost:3500${route}`, { headers: { 'x-payment': fakePayment } });
    const ms = Date.now() - t0;
    const body = await res.json().catch(() => null);
    results[name] = {
      status: res.status,
      elapsed_ms: ms,
      fail_mode: res.status === 200 ? 'FAIL OPEN (resource served)' : 'fail closed',
      reason: body && body.reason,
    };
  }

  server.close();
  hang.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
