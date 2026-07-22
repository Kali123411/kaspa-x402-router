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

Corridor #1 (**inbound: Base → Kaspa**) is proven end-to-end on testnet: a buyer paid USDC on **Base Sepolia** and received a live result from a **Kaspa mainnet** service, with the KAS leg settled on-chain. MVP — see the roadmap.

## How it works

- **Base side** — [`@x402/express`](https://www.npmjs.com/package/@x402/express) middleware gates `/call` behind an x402 USDC payment, verified/settled by a hosted x402 facilitator (`https://x402.org/facilitator` on testnet; Coinbase CDP on mainnet). The buyer pays gaslessly via EIP-3009 — the facilitator pays the gas.
- **Kaspa side** — on payment, the handler shells out to [`kx402`](https://www.npmjs.com/package/kx402) to pay the target Kaspa x402 gateway in KAS and returns its result. Only whitelisted Kaspa services are proxied (no arbitrary URLs).

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
- Corridor #2 — **outbound**: Kaspa agents paying for Base x402 services
- Mainnet (Base mainnet USDC via the CDP facilitator)
- More chains — the router is the wedge into Kaspa-as-an-interop-hub

## Layout

- `src/server.mjs` — the router (Base-side x402 front door + Kaspa-side settlement)
- `src/pricing.mjs` — live KAS-USD rate + the FX price formula
- `src/buyer.mjs` — a test client that pays and fetches
- `src/services.mjs` — whitelist of Kaspa x402 gateways (each with its USD price)

## License

MIT. Testnet/MVP — not audited, not for production value.
