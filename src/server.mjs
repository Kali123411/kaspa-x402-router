// kaspa-x402 facilitator — corridor #1: pay USDC on Base → consume a Kaspa x402 service (KAS).
// Base side: @x402/express middleware verifies/settles USDC via a hosted x402 facilitator.
// Kaspa side: shells out to kx402 (our KAS payer) to pay the target gateway and returns its result.
import { config } from "dotenv";
import express from "express";
import { spawn } from "node:child_process";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { SERVICES } from "./services.mjs";
config();

const { EVM_ADDRESS, EVM_NETWORK, FACILITATOR_URL, PRICE, PORT, KX402, KX402_CONFIG } = process.env;
for (const [k, v] of Object.entries({ EVM_ADDRESS, EVM_NETWORK, FACILITATOR_URL, PRICE, KX402, KX402_CONFIG })) {
  if (!v) { console.error(`missing env ${k}`); process.exit(1); }
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(EVM_NETWORK, new ExactEvmScheme());

const app = express();

// --- unpaid routes ---
app.get("/", (_req, res) =>
  res.json({
    service: "kaspa-x402 facilitator",
    corridor: "Base (USDC) → Kaspa (KAS)",
    price: PRICE,
    network: EVM_NETWORK,
    receiver: EVM_ADDRESS,
    usage: "GET /call?service=<id>&<params>  (pay USDC on Base, get the Kaspa service result)",
    services: Object.keys(SERVICES),
  }),
);
app.get("/health", (_req, res) => res.json({ ok: true }));

// --- paid proxy route (USDC on Base gates it) ---
app.use(
  paymentMiddleware(
    {
      "GET /call": {
        accepts: [{ scheme: "exact", price: PRICE, network: EVM_NETWORK, payTo: EVM_ADDRESS }],
        description: "Pay USDC on Base; the facilitator pays the target Kaspa x402 service in KAS and returns its result.",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/call", async (req, res) => {
  const { service, ...rest } = req.query;
  const base = SERVICES[service];
  if (!base) {
    return res.status(400).json({ error: `unknown service '${service}'; choose one of: ${Object.keys(SERVICES).join(", ")}` });
  }
  const qs = new URLSearchParams(rest).toString();
  const targetUrl = qs ? `${base}?${qs}` : base;
  try {
    const { result, settlement } = await payKaspa(targetUrl);
    res.json({ ok: true, via: "kaspa-x402-router", target: targetUrl, kaspaSettlement: settlement, result });
  } catch (e) {
    // Payment was already collected on Base here. MVP surfaces the failure; refund/retry is a TODO.
    console.error("kaspa settlement failed (USDC already collected):", String(e).slice(0, 300));
    res.status(502).json({ ok: false, error: "kaspa settlement failed", detail: String(e).slice(0, 300) });
  }
});

// Shell out to kx402 to pay the Kaspa gateway; return { result, settlement } where settlement is a
// verifiable receipt of the KAS leg (txid + amount + finality) parsed from kx402's output.
function payKaspa(url) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [KX402, "pay", url, "--config-file", KX402_CONFIG], { timeout: 180000 });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      const txid = (out.match(/settled tx (\w{60,72})/) || [])[1] || null;
      const amountKas = (out.match(/paid ([\d.]+) KAS/) || [])[1] || null;
      const finality = (out.match(/finality:\s*(\w+)/) || [])[1] || null;
      const settlement = txid
        ? {
            network: "kaspa:mainnet",
            txid,
            amountKas: amountKas ? Number(amountKas) : null,
            finality,
            explorer: `https://explorer.kaspa.org/txs/${txid}`,
          }
        : null;
      const line = out.split("\n").find((l) => l.startsWith("result:"));
      if (line) {
        try { return resolve({ result: JSON.parse(line.slice(7).trim()).result, settlement }); } catch { /* fall through */ }
      }
      if (code === 0 && txid) return resolve({ result: { note: "paid; no structured result" }, settlement });
      reject(new Error((err || out).slice(-300) || `kx402 exited ${code}`));
    });
    p.on("error", reject);
  });
}

app.listen(Number(PORT || 4402), () =>
  console.log(`kaspa-x402 facilitator on :${PORT || 4402}  (receiver ${EVM_ADDRESS} on ${EVM_NETWORK}, facilitator ${FACILITATOR_URL})`),
);
