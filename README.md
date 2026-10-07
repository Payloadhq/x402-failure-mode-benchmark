# x402 Failure-Mode Benchmark

**Real x402 implementations tested against seven production failure modes. By Payload.**

A reproducible, black-box benchmark. Every number below was measured; cells
that could not be measured live (they would require spending real money
on-chain or contacting a live facilitator) are labeled **code inspection** and
cite the exact source examined.

The failure modes come from ["x402 in production: the failure modes nobody
warns you about"](https://dev.to/payload-tools/x402-in-production-the-failure-modes-nobody-warns-you-about-366o).

**Implementations under test:** Payload Veyline Developer Primer 1.0.0
(commercial kit, extracted ZIP; since renamed the Veyline Developer Primer) ·
x402-hono 1.2.0 (npm, v1-generation package) ·
@x402/express 2.28.0 (npm, @x402/express + @x402/core + @x402/evm).

## Results (measured 2026-10-03)

| # | Failure mode | Payload kit 1.0.0 | x402-hono 1.2.0 | @x402/express 2.28.0 |
|---|---|---|---|---|
| 1 | Replay: is a reused payment rejected? | **No** (live). Same dev-verifier payment accepted twice across nonces; expired requirements also accepted. Replay protection is delegated to the facilitator/chain in production. | n/a in middleware (code inspection). v1 exact scheme relies on on-chain EIP-3009 nonce + validity window. | n/a in middleware (code inspection). Same EIP-3009 mechanism. |
| 2 | 402 completeness | **Complete** (live). 402 + `payment-required` header + JSON body; amount, asset, network, payTo, expiresAt, nonce all present. | **Complete, body-only** (live). `accepts[]` has scheme, network, maxAmountRequired, asset, payTo, maxTimeoutSeconds. No nonce field (v1 protocol). | Shape `{x402Version, error, resource, accepts[]}` (code inspection). No live test; needs facilitator. |
| 3 | Manifest parity | **2/2 match** (live). `/.well-known/x402` prices equal enforced prices. | **Absent** (live). `/.well-known/x402` → 404. | **Absent** (code inspection). Discovery via opt-in bazaar extension. |
| 4 | Facilitator down: fail open or closed? | **Fail closed** (live). 402 on refused connection (40 ms) and on hang (timeout honored, ~3000 ms as configured). | Fail closed on error (code inspection), but the verify fetch has **no client-side timeout**. | **Fail closed** (code inspection). |
| 5 | Dev-verifier boot guard | **None** (code inspection). The example boots with the dev verifier unconditionally; "never ship it" is documentation, not enforcement. | n/a: no dev verifier exists. | n/a: no dev verifier exists. |
| 6 | Mismatch diagnostics | **Reason strings** (live). `amount mismatch`, `wrong asset or network`, `wrong recipient` in the 402 body; no structured expected/actual fields. | Malformed → 402 with decoder error (live). Amount matching happens in the facilitator, not the middleware (code inspection). | Not tested (needs facilitator). |
| 7 | Payment ledger | **Yes** (live). Append-only JSONL; `/api/ledger` endpoint; +2 paid calls → +2 entries. | **No** (code inspection). | **No** (code inspection). |

"Live" = measured by a probe script in `/probes` against a locally running
instance. "Code inspection" = read from the installed package source, cited in
`results/results.json`. Nothing here is estimated.

## Reproduce

```bash
# 1. Payload kit
unzip x402-paid-api-starter-kit-v1.0.0.zip -d /tmp/x402bench
cd /tmp/x402bench && npm install
node /path/to/probes/probe-payload-replay.js      # T1 + T6
node /path/to/probes/probe-payload-surface.js     # T2 + T3 + T7
node /path/to/probes/probe-payload-facilitator.js # T4

# 2. x402-hono
npm install x402-hono hono @hono/node-server
node probes/hono-server.js 3411 &                   # fixture (see probes/)
node probes/probe-hono.js                          # T2 + T3 + T6

# 3. @x402/express v2: code inspection only (needs a live facilitator;
#    this environment has no network route to one). See results.json for
#    the exact source lines examined.
```

Probe scripts are committed in `/probes`; machine-readable results in
`/results/results.json`.

## Limitations

- The Payload kit was tested with its **dev verifier** (HMAC test double),
  because the facilitator path requires a live facilitator. Findings 1 and 5
  apply to the dev verifier, which the kit documents as test-only. The
  production facilitator path was tested for failure behavior (T4) with a
  stubbed facilitator.
- x402-hono's payment-acceptance path (verify/settle) was not exercised: it
  would require a real on-chain payment.
- The official v2 example was not run live: its middleware requires
  facilitator `initialize()` before it can build payment requirements, and no
  facilitator was reachable. Its cells are code inspection of
  `@x402/core@2.28.0`'s installed source.
- Differences mostly reflect protocol generation (v1 vs v2) and scope (focused
  middleware vs full SDK), not a ranking. Read the table as behavior, not
  verdicts.
- One claim in the companion dev.to article: "the verifier rejects expired or
  already-seen nonces." It does not hold for the kit's dev verifier in v1.0.0, as
  measured in T1. The article has been noted for a correction.

## When x402 breaks

- **callx402 by Payload — powered by Veyline** diagnoses and rescues broken
  x402 calls. When x402 breaks, callx402.
- **Veyline by Payload** is the production layer for x402 + MCP: autonomous
  economic control for machine commerce.

Built by [Payload](https://payloadhq.github.io/).

## License

Benchmark code and results: MIT. The implementations under test keep their own
licenses (Payload kit: commercial; x402 packages: Apache-2.0).
