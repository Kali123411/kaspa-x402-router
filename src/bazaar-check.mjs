// Check whether the router is listed in the Coinbase CDP x402 Bazaar (discovery catalog).
// CDP indexes asynchronously, so run this periodically after payments have flowed through.
//   node src/bazaar-check.mjs
import { config } from "dotenv";
import { createFacilitatorConfig } from "@coinbase/x402";
config({ path: process.env.ENV_FILE || ".env.mainnet" });

const fc = createFacilitatorConfig();
const auth = fc.createAuthHeaders ? await fc.createAuthHeaders("discovery/search") : { headers: {} };
const res = await fetch(fc.url + "/discovery/search?q=" + encodeURIComponent("kaspa-402"), {
  headers: auth.headers || {}, signal: AbortSignal.timeout(15000),
});
const j = await res.json();
const items = j.resources || j.items || [];
const mine = items.filter((r) => JSON.stringify(r).includes("kaspa-402.org"));

if (mine.length) {
  console.log("✅ LISTED in the CDP bazaar:");
  for (const m of mine) console.log("   " + (m.resource || m.resourceUrl || JSON.stringify(m).slice(0, 120)));
} else {
  console.log(`⏳ not indexed yet — searched ${items.length} results for "kaspa-402", none are ours.`);
  console.log('   The router declares the bazaar extension and payments echo it; CDP indexes asynchronously.');
  console.log('   Re-run this after more traffic / later. If it never appears, check the extension validates or ask CDP about their indexer.');
}
