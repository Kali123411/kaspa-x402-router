// Test buyer — pays the facilitator in Base Sepolia USDC (gasless EIP-3009) and prints the result.
// Usage:
//   node src/buyer.mjs                        # dry: print buyer address + config, no call
//   node src/buyer.mjs "<facilitator-url>"    # pay and fetch, e.g. .../call?service=exposure&address=kaspa:...
import fs from "node:fs";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const KEYF = process.env.HOME + "/.config/kaspa-x402-buyer-evm.key";
const RPC = process.env.EVM_RPC_URL || "https://sepolia.base.org";
const pk = fs.readFileSync(KEYF, "utf8").trim();
const account = privateKeyToAccount(pk);

const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(account, { rpcUrl: RPC }));

const url = process.argv[2];
if (!url) {
  console.log("buyer wallet :", account.address);
  console.log("rpc          :", RPC);
  console.log("(dry run — pass a facilitator URL to actually pay)");
  process.exit(0);
}

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
console.log("→ calling (auto-pays 402):", url);
const res = await fetchWithPayment(url, { method: "GET" });
const ct = res.headers.get("content-type") || "";
const body = ct.includes("application/json") ? await res.json() : await res.text();
console.log("status:", res.status);
console.log("body  :", typeof body === "string" ? body : JSON.stringify(body, null, 2));
