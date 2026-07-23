# Corridor #2 go-live runbook (Kaspa KAS → Base USDC)

A Kaspa agent pays KAS and consumes a Base x402 service. This is the reverse of corridor #1.

## Flow

```
Kaspa agent  --pays KAS-->  kaspa-402-outbound (CF worker, collects KAS to the shared payee)
                              |  POST {target,...params} + X-Gateway-Secret
                              v
                            agent.kaspa-402.org/raw/outbound  (provider2, secret-gated)
                              |  GET /outbound?target=... + X-Gateway-Secret
                              v
                            router :8527 /outbound  (whitelisted BASE_TARGETS)
                              |  pays USDC on Base (0xCB3f, gasless EIP-3009)
                              v
                            Base x402 service (echo target, or a real one)  -->  result flows back
```

KAS revenue lands in the shared payee `kaspa:qzws2a0l…` — the same wallet the router's rebalancer
sweeps into the payer float. So corridor #2 income offsets corridor #1's KAS spend.

## Already done (this box)

- `provider2 /raw/outbound` — live (restart: `systemctl --user restart k402-provider2.service`).
- Router outbound leg — `.env.mainnet` has `OUTBOUND_KEY` (0xCB3f) + `EVM_RPC_URL=https://mainnet.base.org`.
- `kaspa-x402-echo` — Base-mainnet test target (`systemctl --user status kaspa-x402-echo`), payTo 0xF2d9.
- Router→echo mainnet payment leg proven ($0.01 real, on-chain).
- `~/.config/k402-provider2.env` has `ROUTER_OUTBOUND_SECRET` (= router `ROUTER_SECRET`) + `ROUTER_OUTBOUND_URL`.

## 1. Deploy the gateway  (done)

```bash
cd ~/kaspa-402-gateway
npx wrangler deploy -c wrangler.outbound.jsonc     # needs CLOUDFLARE_API_TOKEN in-shell
```

## 2. Set the two gateway secrets

```bash
cd ~/kaspa-402-gateway
# admin token — must equal ~/.config/kaspa-402-admin.token (used by the price-refresh below)
npx wrangler secret put KASPA_X402_ADMIN_TOKEN   -c wrangler.outbound.jsonc
# backend secret — MUST equal provider2's GATEWAY_SHARED_SECRET (~/.config/k402-provider2.env)
npx wrangler secret put KASPA_X402_BACKEND_SECRET -c wrangler.outbound.jsonc
```

## 3. Refresh the KAS price (optional; the 0.5-KAS floor already covers the $0.01 echo)

```bash
curl -X POST https://kaspa-402-outbound.kaspadev.workers.dev/admin/refresh-price \
  -H "authorization: Bearer $(cat ~/.config/kaspa-402-admin.token)"
# for the recurring cron: add "outbound" to the gateway loop in ~/kaspa-402-gateway/refresh-prices.sh
```

## 4. Verify the gateway (no spend)

```bash
# expect HTTP 402 + a PAYMENT-REQUIRED header (amount 50000000 sompi = 0.5 KAS, payTo kaspa:qzws2a0l…)
curl -s -D - -o /dev/null "https://kaspa-402-outbound.kaspadev.workers.dev/exact?target=echo&msg=hi" \
  | grep -i payment-required
```

## 5. Certify the full loop (real ~0.5 KAS + $0.01 USDC)

```bash
# kx402 pays the gateway in KAS; the chain runs end-to-end and returns the Base echo + a KAS receipt.
node ~/kx402/src/kx402.mjs pay \
  "https://kaspa-402-outbound.kaspadev.workers.dev/exact?target=echo&msg=hello-from-kaspa" \
  --json --config-file ~/kx402/.env.mainnet
# success = JSON with the echo body ({service:"base-echo", echo:{msg:"hello-from-kaspa"}, paidWith:"USDC on Base"})
```

If it hangs or 502s, the usual cause is the `KASPA_X402_BACKEND_SECRET` ≠ provider2 `GATEWAY_SHARED_SECRET`
(step 2), or provider2/router/echo not running (see Ops).

## Swap the echo target for a real Base x402 service

Whitelist it in `~/kaspa-x402-router/src/services.mjs` under `BASE_TARGETS`
(`{ realsvc: { url: "https://…", usd: 0.05 } }`), restart the router, and call with `?target=realsvc`.
Keep the gateway `KASPA_X402_PRICE_USD` ≥ the priciest target + margin.

## Ops

| Component        | Where                                             | Restart |
|------------------|---------------------------------------------------|---------|
| Router (:8527)   | `~/kaspa-x402-router` / `.env.mainnet`            | `systemctl --user restart kaspa-x402-router` |
| Echo target      | `kaspa-x402-echo` unit (:4403, Base mainnet)      | `systemctl --user restart kaspa-x402-echo` |
| Backend          | `provider2 /raw/outbound` (:8521)                 | `systemctl --user restart k402-provider2` |
| Gateway          | `kaspa-402-outbound` CF worker                    | `npx wrangler deploy -c wrangler.outbound.jsonc` |
| Wallets          | payer 0xCB3f (USDC out) → payTo 0xF2d9; KAS → kaspa:qzws2a0l… (swept to float) | — |
```
