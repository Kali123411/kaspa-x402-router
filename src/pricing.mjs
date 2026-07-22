// FX pricing for the Base leg. The router pays the Kaspa gateway in KAS (USD-priced, floored at
// 0.5 KAS) and must collect enough USDC to cover that cost plus a margin. Base price =
//   max(serviceUSD, KAS_FLOOR × kasUsd) × (1 + MARGIN)
// The max() accounts for the gateway's 0.5-KAS floor making cheap services cost more than nominal.
const RATE_URL = process.env.KAS_PRICE_URL || "https://api.kaspa.org/info/price";
const MARGIN = Number(process.env.MARGIN ?? "0.20"); // router spread over cost
const KAS_FLOOR = 0.5; // gateways' MIN_PRICE (0.5 KAS)
const FALLBACK_RATE = 0.03; // used only before the first successful fetch

let kasUsd = null;
let lastOk = 0;

export async function refreshRate() {
  try {
    const r = await fetch(RATE_URL, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const p = Number(j.price ?? j.priceUsd ?? j.usd);
    if (p > 0) { kasUsd = p; lastOk = Date.now(); }
  } catch { /* keep the last good rate */ }
  return kasUsd;
}

export function rateInfo() {
  return { kasUsd, margin: MARGIN, kasFloor: KAS_FLOOR, ageSec: lastOk ? Math.round((Date.now() - lastOk) / 1000) : null };
}

// Returns a "$X.XX" price string for a service whose Kaspa-side cost is `serviceUsd`.
export function priceUsd(serviceUsd) {
  const rate = kasUsd || FALLBACK_RATE;
  const costUsd = Math.max(serviceUsd, KAS_FLOOR * rate); // whichever the gateway will actually charge
  const withMargin = costUsd * (1 + MARGIN);
  const rounded = Math.ceil(withMargin * 100) / 100; // round up to the cent so we never undercharge
  return `$${rounded.toFixed(2)}`;
}
