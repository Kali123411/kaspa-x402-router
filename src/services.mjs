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
