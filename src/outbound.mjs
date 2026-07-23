// Corridor #2 outbound leg: the router pays a Base x402 service in USDC (as an x402 client) and
// returns the result. Funded by the receiver wallet (the USDC earned from corridor #1).
// Gasless for the router — it signs an EIP-3009 authorization; the target's facilitator pays gas.
import fs from "node:fs";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

export async function payBaseService(url) {
  // Resolve at CALL time, not module-load time: server.mjs imports this module BEFORE it loads
  // .env.mainnet (ES imports run first), so reading these at the top would miss OUTBOUND_KEY/EVM_RPC_URL.
  const KEYF = process.env.OUTBOUND_KEY || process.env.HOME + "/.config/kaspa-x402-facilitator-evm.key";
  const RPC = process.env.EVM_RPC_URL || "https://sepolia.base.org";
  const account = privateKeyToAccount(fs.readFileSync(KEYF, "utf8").trim());
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(account, { rpcUrl: RPC }));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const res = await fetchWithPayment(url, { method: "GET" });
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, body: ct.includes("json") ? await res.json() : await res.text(), payer: account.address };
}

// CLI: node src/outbound.mjs "<base-x402-url>"
if (process.argv[1] && process.argv[1].endsWith("outbound.mjs")) {
  const url = process.argv[2];
  if (!url) { console.error("usage: node src/outbound.mjs <base-x402-url>"); process.exit(1); }
  payBaseService(url).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(String(e)); process.exit(1); });
}
