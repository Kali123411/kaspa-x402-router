// Check whether the router is listed on agentic.market (Coinbase's public x402 marketplace, the
// front-end of the CDP x402 discovery catalog). Public endpoint, no auth.
//   node src/bazaar-check.mjs
const Q = "router.kaspa-402.org";
const res = await fetch("https://api.agentic.market/v1/services/search?q=" + encodeURIComponent(Q), {
  signal: AbortSignal.timeout(15000),
});
const j = await res.json().catch(() => ({}));
const items = j.services || j.results || j.items || (Array.isArray(j) ? j : []);
const mine = items.filter((s) => JSON.stringify(s).includes("router.kaspa-402.org"));

if (mine.length) {
  console.log("✅ LISTED on agentic.market (& the CDP bazaar):");
  for (const m of mine) console.log("   " + (m.name || m.id) + " — " + ((m.endpoints || [{}])[0].url || ""));
} else {
  console.log(`⏳ not listed yet — searched agentic.market ("${Q}"), ${items.length} fuzzy result(s), none ours.`);
  console.log("   The router declares the bazaar extension (https resource, valid schema) and payments echo it.");
  console.log("   Coinbase's CDP indexer runs asynchronously; agentic.market surfaces it once indexed. Re-run later.");
}
