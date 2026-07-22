// Minimal Base x402 service used as a corridor-#2 test target: charges $0.01 USDC on Base Sepolia,
// returns an echo. Stands in for "some Base x402 service" the router pays on a Kaspa agent's behalf.
import { config } from "dotenv";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
config();

const PAYTO = process.env.ECHO_PAYTO || "0xCB3f38582762CF22814968a789642c8717619dd9"; // buyer wallet receives
const NET = process.env.EVM_NETWORK || "eip155:84532";
const FAC = process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const PORT = process.env.ECHO_PORT || 4403;

const app = express();
app.get("/", (_req, res) => res.json({ service: "base-echo (x402 test target)", price: "$0.01", payTo: PAYTO }));
app.use(
  paymentMiddleware(
    { "GET /echo": { accepts: { scheme: "exact", price: "$0.01", network: NET, payTo: PAYTO }, description: "echo the query", mimeType: "application/json" } },
    new x402ResourceServer(new HTTPFacilitatorClient({ url: FAC })).register(NET, new ExactEvmScheme()),
  ),
);
app.get("/echo", (req, res) => res.json({ service: "base-echo", echo: req.query, paidWith: "USDC on Base" }));
app.listen(Number(PORT), () => console.log(`base-echo x402 target on :${PORT} (payTo ${PAYTO})`));
