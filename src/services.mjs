// Whitelist of Kaspa x402 services the router will proxy to, with each service's USD price
// (the gateways are USD-priced, floored at 0.5 KAS). Client calls /call?service=<id>&<params>.
// Whitelisted (not arbitrary URLs) to avoid SSRF and to only front our own services.
export const SERVICES = {
  exposure: { url: "https://kaspa-402-exposure.kaspadev.workers.dev/exact", usd: 0.10 }, // ?address=kaspa:...
  cluster: { url: "https://kaspa-402-cluster.kaspadev.workers.dev/exact", usd: 0.15 }, // ?address=kaspa:...
  ghost: { url: "https://kaspa-402-ghost.kaspadev.workers.dev/exact", usd: 0.10 }, // ?target=kaspa:... | txid
  ask: { url: "https://kaspa-402-ask.kaspadev.workers.dev/exact", usd: 0.03 }, // ?q=...
  research: { url: "https://kaspa-402-research.kaspadev.workers.dev/exact", usd: 0.10 }, // ?asset=krc20:NACHO
  redteam: { url: "https://kaspa-402-redteam.kaspadev.workers.dev/exact", usd: 0.20 }, // ?scriptHex=...
  reserve: { url: "https://kaspa-402-reserve.kaspadev.workers.dev/exact", usd: 0.15 }, // ?covenantAddress=kaspa:...
};

export const DEFAULT_USD = 0.2; // fallback price for an unrecognized service id

// Corridor #2 (outbound): Base x402 services the router will pay for on a Kaspa agent's behalf.
// Whitelisted so a Kaspa caller can't make the router pay an arbitrary/expensive Base URL.
// `usd` is the Base service's price — the collect gateway must charge KAS covering this + margin.
export const BASE_TARGETS = {
  echo: { url: process.env.ECHO_URL || "http://localhost:4403/echo", usd: 0.01 }, // local test target
  // CoinGecko on-chain token price ($0.01, GET, Base mainnet). {contract} is a path param, validated
  // against pathParams and substituted into the FIXED host/path — a caller can only fill the token
  // address, never redirect the request elsewhere. Extra flags (include_24hr_vol, …) ride as query.
  coingecko: {
    url: "https://pro-api.coingecko.com/api/v3/x402/onchain/simple/networks/base/token_price/{contract}",
    usd: 0.01,
    pathParams: { contract: /^0x[0-9a-fA-F]{40}$/ },
  },

  // --- agentic.market top-10 leaderboard imports (price = real probed 402 amount = the spend cap) ---
  // Only services that fit the outbound gateway's KAS band (~0.5 KAS ≈ $0.014) are here. Excluded:
  // Claude/Venice ($10) & Deepgram ($1) — need a higher-priced gateway; CoinMarketCap — 402 was
  // malformed ($10B on BSC); ChatGPT /models — free (nothing to pay). POST targets take ?body=<json>.
  tripadvisor: { url: "https://tripadvisor.x402.paysponge.com/api/v1/location/{locationId}/details", usd: 0.01, pathParams: { locationId: /^[0-9]{1,12}$/ } },
  exa: { url: "https://api.exa.ai/contents", method: "POST", usd: 0.001 },
  thegraph: { url: "https://gateway.thegraph.com/api/x402/subgraphs/id/{subgraph_id}", method: "POST", usd: 0.01, pathParams: { subgraph_id: /^[A-Za-z0-9]{20,80}$/ } },
  alchemy: { url: "https://x402.alchemy.com/{chainNetwork}/v2", method: "POST", usd: 0.001, pathParams: { chainNetwork: /^[a-z0-9-]{3,30}$/ } },
  parallel: { url: "https://parallelmpp.dev/api/search", method: "POST", usd: 0.01 },
  perplexity: { url: "https://pplx.x402.paysponge.com/search", method: "POST", usd: 0.01 },

  // --- higher tier (>$0.02): only reachable via the kaspa-402-outbound-hi gateway (tierMax 1.50) ---
  // Deepgram speech-to-text ($1): POST {"url":"https://…/audio.wav"} (or audio bytes). Excluded still:
  // Claude/Venice ($10) would need a third even-higher tier (~360 KAS/call) — impractical, left out.
  deepgram: { url: "https://deepgram.x402.paysponge.com/v1/listen", method: "POST", usd: 1.00 },
};

// Build the concrete target URL: substitute {placeholder} path params (each validated against the
// target's pathParams regex, so the host/path stays fixed) and forward the rest as the query string.
// Throws on a missing/invalid path param.
export function buildTargetUrl(t, params) {
  const rest = { ...params };
  let url = t.url;
  for (const [name, re] of Object.entries(t.pathParams || {})) {
    const v = rest[name];
    if (v == null || !re.test(String(v))) throw new Error(`invalid or missing path param '${name}'`);
    url = url.replace(`{${name}}`, encodeURIComponent(String(v)));
    delete rest[name];
  }
  const qs = new URLSearchParams(rest).toString();
  return qs ? `${url}?${qs}` : url;
}
