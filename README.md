# kaspa-x402-router

**Pay on one chain, consume a service on another.** A cross-chain [x402](https://x402.org) payment router: an agent holding **USDC on Base** calls a **Kaspa-native x402 service** and gets the result — without ever holding KAS. The router collects the USDC leg and settles the KAS leg on the agent's behalf.

It is **not an asset bridge.** Nothing is locked, minted, or custodied in a pool. The router is a paying proxy that holds its own working KAS and takes a spread — no honeypot TVL.

```
  Base agent (USDC)
        │  x402 payment (gasless EIP-3009)
        ▼
  ┌─────────────────────────────┐
  │  kaspa-x402-router          │   Base side:  @x402/express + hosted x402 facilitator
  │  /call?service=…            │   Kaspa side: kx402 pays the target gateway in KAS
  └─────────────────────────────┘
        │  KAS settlement (Kaspa mainnet)
        ▼
  Kaspa x402 service  ──►  result flows back to the agent
```

## Status

**Both directions are live and certified on Base mainnet.**

- **Corridor #1 — inbound (Base → Kaspa):** live at **[router.kaspa-402.org](https://router.kaspa-402.org)**. Buyers pay USDC on Base (via the Coinbase CDP facilitator) and get results from Kaspa mainnet services, each with an on-chain settlement receipt. It is **discoverable on [agentic.market](https://agentic.market/services/router-kaspa-402-org)** (Coinbase's x402 marketplace), so agents can find and call it automatically.
- **Corridor #2 — outbound (Kaspa → Base):** certified end-to-end. A Kaspa agent holding only KAS pays a Kaspa x402 gateway, and the router pays the target Base x402 service in USDC on its behalf — result and KAS receipt flow back. The collected KAS lands in the same payee the rebalancer sweeps, so corridor #2 income offsets corridor #1's KAS spend. See [`docs/CORRIDOR2-RUNBOOK.md`](docs/CORRIDOR2-RUNBOOK.md).

The KAS working float is **self-funding** (an auto-rebalancer recycles the payer↔payee loop), and health is on a dashboard panel. Not audited — see the disclaimer.

## How it works

**Corridor #1 (inbound):**

- **Base side** — [`@x402/express`](https://www.npmjs.com/package/@x402/express) middleware gates `/call` behind an x402 USDC payment, verified/settled by a hosted x402 facilitator (`https://x402.org/facilitator` on testnet; Coinbase CDP on mainnet). The buyer pays gaslessly via EIP-3009 — the facilitator pays the gas. The route advertises a canonical resource URL + a [bazaar discovery extension](https://www.npmjs.com/package/@x402/extensions) so CDP catalogs it and agents can discover it.
- **Kaspa side** — on payment, the handler shells out to [`kx402`](https://www.npmjs.com/package/kx402) to pay the target Kaspa x402 gateway in KAS and returns its result. Only whitelisted Kaspa services are proxied (no arbitrary URLs).

**Corridor #2 (outbound):** a Kaspa x402 gateway collects KAS, then calls the router's secret-gated `/outbound`, which pays the target Base x402 service as a client (`src/outbound.mjs`, gasless EIP-3009). Only whitelisted Base targets are payable (no arbitrary URLs). The KAS→Base leg is priced by the collecting gateway (Base cost + margin). Full wiring in [`docs/CORRIDOR2-RUNBOOK.md`](docs/CORRIDOR2-RUNBOOK.md).

## Quickstart

```bash
npm install

# configure (see .env)
#   FACILITATOR_URL=https://x402.org/facilitator
#   EVM_ADDRESS=0x...            # receiver wallet
#   EVM_NETWORK=eip155:84532     # Base Sepolia
#   MARGIN=0.20                  # router spread over the Kaspa cost (default 0.20)
#   KX402=/path/to/kx402/src/kx402.mjs   KX402_CONFIG=/path/to/.env.mainnet

npm start        # facilitator on :4402

# buyer (needs Base Sepolia USDC + a wallet key):
node src/buyer.mjs "http://localhost:4402/call?service=exposure&address=kaspa:..."
```

## Pricing

Per-request FX pricing. The Base price for a call is computed from the target Kaspa service's cost at the live KAS-USD rate, plus a margin:

```
price(USDC) = max(serviceUSD, 0.5 KAS × rate) × (1 + MARGIN)   # rounded up to the cent
```

The `max()` accounts for the gateways' 0.5-KAS floor, so cheap services never sell below cost. `GET /` returns the live rate and the current price table.

## Roadmap

- ~~Settlement receipt (verifiable KAS-leg txid in the response)~~ ✓
- ~~FX-based pricing + configurable margin~~ ✓
- ~~Mainnet on Base (Coinbase CDP facilitator)~~ ✓ — **live at `router.kaspa-402.org`**
- ~~Self-funding: KAS auto-rebalancer (payer↔payee loop)~~ ✓
- ~~Health monitoring (dashboard panel)~~ ✓
- ~~Hardening: serialized KAS settlement, reject-before-charge, active alerting~~ ✓
- ~~Bazaar discovery — canonical resource URL + discovery extension, indexed on agentic.market~~ ✓
- ~~Corridor #2 — **outbound** (Kaspa agents paying for Base x402 services)~~ ✓ — **certified end-to-end on mainnet** (see the runbook)
- ~~Outbound price cap — refuse a Base target that would overcharge the payer~~ ✓
- ~~Refunds on a failed KAS leg~~ — **not needed**: the x402 middleware cancels the USDC settlement on a ≥400 response, so a failed call never charges the buyer (verified on mainnet). The failed-call log is an observability signal, not a refund ledger.
- Multi-UTXO payer for concurrency — deferred: needs `kx402` to expose UTXO pinning so the router can assign a distinct UTXO per concurrent call (today settlements are correctly serialized). Not needed at current volume.
- More chains — the router is the wedge into Kaspa-as-an-interop-hub

## Layout

- `src/server.mjs` — the router (corridor #1 `/call` + corridor #2 collect `/outbound`)
- `src/pricing.mjs` — live KAS-USD rate + the FX price formula
- `src/rebalance.mjs` — KAS auto-rebalancer (sweeps payer↔payee; runs on a systemd timer)
- `src/alert.mjs` — alerting: rebalancer stale/starved, float low, router down, failed settlements (set `ALERT_WEBHOOK`)
- `src/buyer.mjs` — a test client that pays and fetches (corridor #1)
- `src/outbound.mjs` — corridor #2 outbound leg: pay a Base x402 service as a client
- `src/echo-target.mjs` — a minimal Base x402 service used to test the outbound leg (Sepolia or, with CDP keys, mainnet)
- `src/services.mjs` — whitelists: Kaspa gateways (each with its USD price) + Base targets
- `docs/CORRIDOR2-RUNBOOK.md` — deploy + certify the outbound (Kaspa → Base) corridor

## License

MIT. Testnet/MVP — not audited, not for production value.
