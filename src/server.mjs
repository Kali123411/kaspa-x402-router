// kaspa-x402 facilitator — corridor #1: pay USDC on Base → consume a Kaspa x402 service (KAS).
// Base side: @x402/express middleware verifies/settles USDC via a hosted x402 facilitator.
// Kaspa side: shells out to kx402 (our KAS payer) to pay the target gateway and returns its result.
import { config } from "dotenv";
import express from "express";
import { spawn } from "node:child_process";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { SERVICES, DEFAULT_USD, BASE_TARGETS } from "./services.mjs";
import { refreshRate, rateInfo, priceUsd } from "./pricing.mjs";
import { payBaseService } from "./outbound.mjs";
config({ path: process.env.ENV_FILE || ".env" });

const { EVM_ADDRESS, EVM_NETWORK, FACILITATOR_URL, PORT, KX402, KX402_CONFIG, ROUTER_SECRET } = process.env;
for (const [k, v] of Object.entries({ EVM_ADDRESS, EVM_NETWORK, FACILITATOR_URL, KX402, KX402_CONFIG })) {
  if (!v) { console.error(`missing env ${k}`); process.exit(1); }
}

// Mainnet: Coinbase CDP facilitator (signed JWT auth from CDP_API_KEY_ID/SECRET). Testnet: x402.org.
const useCdp = !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
const facilitatorClient = new HTTPFacilitatorClient(useCdp ? createFacilitatorConfig() : { url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(EVM_NETWORK, new ExactEvmScheme());

const app = express();

// --- unpaid routes ---
app.get("/", (_req, res) =>
  res.json({
    service: "kaspa-x402-router",
    corridor: "Base (USDC) → Kaspa (KAS)",
    pricing: { model: "max(serviceUSD, 0.5 KAS × rate) × (1 + margin)", ...rateInfo() },
    prices: Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, priceUsd(v.usd)])),
    network: EVM_NETWORK,
    receiver: EVM_ADDRESS,
    usage: "GET /call?service=<id>&<params>  (pay USDC on Base, get the Kaspa service result)",
  }),
);
app.get("/health", (_req, res) => res.json({ ok: true }));

// --- paid proxy route (USDC on Base gates it) ---
app.use(
  paymentMiddleware(
    {
      "GET /call": {
        accepts: {
          scheme: "exact",
          // FX pricing: charge the Kaspa service's cost (in USDC at the live rate) + margin, per service.
          price: (context) => priceUsd(SERVICES[context.adapter.getQueryParam?.("service")]?.usd ?? DEFAULT_USD),
          network: EVM_NETWORK,
          payTo: EVM_ADDRESS,
        },
        description: "Pay USDC on Base; the router pays the target Kaspa x402 service in KAS and returns its result + a settlement receipt. Price = Kaspa cost × live FX + margin.",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/call", async (req, res) => {
  const { service, ...rest } = req.query;
  const svc = SERVICES[service];
  if (!svc) {
    return res.status(400).json({ error: `unknown service '${service}'; choose one of: ${Object.keys(SERVICES).join(", ")}` });
  }
  const qs = new URLSearchParams(rest).toString();
  const targetUrl = qs ? `${svc.url}?${qs}` : svc.url;
  try {
    const { result, settlement } = await payKaspa(targetUrl);
    res.json({ ok: true, via: "kaspa-x402-router", target: targetUrl, kaspaSettlement: settlement, result });
  } catch (e) {
    // Payment was already collected on Base here. MVP surfaces the failure; refund/retry is a TODO.
    console.error("kaspa settlement failed (USDC already collected):", String(e).slice(0, 300));
    res.status(502).json({ ok: false, error: "kaspa settlement failed", detail: String(e).slice(0, 300) });
  }
});

// Corridor #2 collect-side backend: a Kaspa x402 gateway collects the KAS, then calls this
// (secret-gated) to have the router pay the target Base x402 service and return its result.
app.get("/outbound", async (req, res) => {
  if (!ROUTER_SECRET || req.get("x-gateway-secret") !== ROUTER_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }
  const { target, ...rest } = req.query;
  const t = BASE_TARGETS[target];
  if (!t) {
    return res.status(400).json({ error: `unknown base target '${target}'; choose: ${Object.keys(BASE_TARGETS).join(", ")}` });
  }
  const qs = new URLSearchParams(rest).toString();
  const url = qs ? `${t.url}?${qs}` : t.url;
  try {
    const base = await payBaseService(url);
    res.json({ ok: true, via: "kaspa-x402-router (outbound)", target: url, base });
  } catch (e) {
    // KAS was already collected upstream here. MVP surfaces the failure; refund is a TODO.
    console.error("base payment failed (KAS already collected):", String(e).slice(0, 300));
    res.status(502).json({ ok: false, error: "base payment failed", detail: String(e).slice(0, 300) });
  }
});

// Shell out to kx402 (structured --json) to pay the Kaspa gateway; return { result, settlement }
// where settlement is a verifiable receipt of the KAS leg (txid + amount + finality).
function payKaspa(url) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [KX402, "pay", url, "--json", "--config-file", KX402_CONFIG], { timeout: 180000 });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      let r;
      try { r = JSON.parse(out); } catch {
        return reject(new Error((err || out).slice(-300) || `kx402 exited ${code}: no JSON`));
      }
      if (!(r.status >= 200 && r.status < 300)) {
        return reject(new Error(`kaspa gateway ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`));
      }
      // settlement txid from the gateway's PAYMENT-RESPONSE header if present, else the payer's broadcast txid
      const txid = r.settlement?.transaction || r.txid || null;
      const settlement = txid
        ? {
            network: "kaspa:mainnet",
            txid,
            amountKas: r.offer?.amount ? Number(r.offer.amount) / 1e8 : null,
            finality: r.settlement?.finality || "accepted",
            explorer: `https://explorer.kaspa.org/txs/${txid}`,
          }
        : null;
      resolve({ result: r.body?.result ?? r.body, settlement });
    });
    p.on("error", reject);
  });
}

await refreshRate();
setInterval(refreshRate, 60_000).unref();

app.listen(Number(PORT || 4402), () =>
  console.log(`kaspa-x402-router on :${PORT || 4402}  (receiver ${EVM_ADDRESS} on ${EVM_NETWORK}; facilitator ${useCdp ? "CDP/mainnet" : "x402.org/testnet"}; KAS-USD ${rateInfo().kasUsd}, margin ${rateInfo().margin})`),
);
