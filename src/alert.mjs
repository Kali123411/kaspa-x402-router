// Alerting hook for the kaspa-x402-router. Watches the rebalancer status file, the router /health,
// and the failed-settlement log; notifies on a change (and on recovery), de-duped so it doesn't spam.
// Set ALERT_WEBHOOK in .env.mainnet (a Discord webhook or any endpoint that accepts {content}).
import { config } from "dotenv";
import fs from "node:fs";
config({ path: process.env.ENV_FILE || ".env.mainnet" });

const HOME = process.env.HOME;
const WEBHOOK = process.env.ALERT_WEBHOOK; // Discord-compatible ({content: msg})
const MIN = Number(process.env.MIN_UTXO_KAS || "8");
const ROUTER_HEALTH = process.env.ROUTER_HEALTH || "http://localhost:8527/health";
const STATUS = `${HOME}/.k402/rebalance-status.json`;
const FAILED = `${HOME}/.k402/router-failed-settlements.jsonl`;
const STATE = `${HOME}/.k402/router-alert-state.json`;
const now = Math.floor(Date.now() / 1000);

const alerts = [];

// router reachable?
let up = false;
try { up = !!(await (await fetch(ROUTER_HEALTH, { signal: AbortSignal.timeout(5000) })).json()).ok; } catch {}
if (!up) alerts.push("🔴 router DOWN — localhost:8527 not responding");

// rebalancer health (from its status file)
try {
  const s = JSON.parse(fs.readFileSync(STATUS, "utf8"));
  const age = now - (s.ts || 0);
  if (age > 600) alerts.push(`🟠 rebalancer STALE — last run ${Math.round(age / 60)}m ago (timer stopped?)`);
  if (s.action === "starved") alerts.push("🔴 KAS loop STARVED — add KAS to the float (payer wallet)");
  if (s.payerLargestKas != null && s.payerLargestKas < MIN)
    alerts.push(`🟠 payer float low — ${s.payerLargestKas.toFixed(2)} KAS < min ${MIN}`);
} catch { alerts.push("🟠 rebalancer status file missing — is the rebalance timer running?"); }

// failed settlements (USDC collected, KAS leg failed → refunds owed)
let failedCount = 0;
try { failedCount = fs.readFileSync(FAILED, "utf8").trim().split("\n").filter(Boolean).length; } catch {}

// previous state (de-dup)
let last = { alerts: [], failedCount: 0 };
try { last = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {}
const newFails = failedCount - (last.failedCount || 0);
if (newFails > 0) alerts.push(`🟠 ${newFails} new failed settlement(s) — buyer(s) owed a refund (router-failed-settlements.jsonl)`);

const key = alerts.slice().sort().join("|");
const lastKey = (last.alerts || []).slice().sort().join("|");
const changed = key !== lastKey || newFails > 0;

if (changed) {
  const msg = alerts.length ? "⚠️ **kaspa-x402-router**\n" + alerts.join("\n") : "✅ kaspa-x402-router recovered — all healthy";
  if (WEBHOOK) {
    try { await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: msg }) }); }
    catch (e) { console.error("webhook post failed:", String(e).slice(0, 120)); }
  }
  try { fs.appendFileSync(`${HOME}/.k402/router-alerts.log`, `${new Date().toISOString()} ${msg.replace(/\n/g, " · ")}\n`); } catch {}
  console.log(msg);
} else {
  console.log(alerts.length ? `(unchanged) ${alerts.length} active alert(s)` : "all healthy");
}
fs.writeFileSync(STATE, JSON.stringify({ alerts, failedCount, ts: now }));

// --- Bazaar listing watch: check the CDP catalog until we're indexed, then alert once. ---
const BAZAAR_STATUS = `${HOME}/.k402/bazaar-status.json`;
let bz = { listed: false };
try { bz = JSON.parse(fs.readFileSync(BAZAAR_STATUS, "utf8")); } catch {}
if (!bz.listed) {
  try {
    const { createFacilitatorConfig } = await import("@coinbase/x402");
    const fc = createFacilitatorConfig();
    const auth = fc.createAuthHeaders ? await fc.createAuthHeaders("discovery/search") : { headers: {} };
    const res = await fetch(fc.url + "/discovery/search?q=" + encodeURIComponent("kaspa-402"), { headers: auth.headers || {}, signal: AbortSignal.timeout(15000) });
    const j = await res.json();
    const items = j.resources || j.items || [];
    const mine = items.filter((r) => JSON.stringify(r).includes("kaspa-402.org"));
    const listed = mine.length > 0;
    const resource = mine[0]?.resource || mine[0]?.resourceUrl || null;
    if (listed) {
      const msg = `🎉 **kaspa-x402-router** is now LISTED in the Coinbase x402 Bazaar — agents can discover it${resource ? ` (${resource})` : ""}`;
      if (WEBHOOK) { try { await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: msg }) }); } catch {} }
      try { fs.appendFileSync(`${HOME}/.k402/router-alerts.log`, `${new Date().toISOString()} ${msg}\n`); } catch {}
      console.log(msg);
    }
    fs.writeFileSync(BAZAAR_STATUS, JSON.stringify({ listed, resource, checkedTs: now }));
  } catch (e) { console.error("bazaar check failed:", String(e).slice(0, 120)); }
} else {
  console.log("bazaar: already listed");
}
