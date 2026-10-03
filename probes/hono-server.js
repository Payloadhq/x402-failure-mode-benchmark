'use strict';
// Live black-box fixture: x402-hono v1.2.0 serving one priced route on base.
// Run: node hono-server.js [port]
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');
const { paymentMiddleware } = require('x402-hono');

const PORT = parseInt(process.argv[2] || '3411', 10);
const app = new Hono();

app.use(paymentMiddleware(
  '0x1234567890123456789012345678901234567890',
  {
    '/protected': {
      price: '$0.10',
      network: 'base',
      config: { description: 'Protected test resource' },
    },
  }
));

app.get('/protected', (c) => c.json({ secret: 'hello' }));
app.get('/open', (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: PORT });
console.log(`x402-hono fixture listening on http://localhost:${PORT}`);
