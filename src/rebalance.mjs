// KAS auto-rebalancer for the router's closed loop. The router pays the Kaspa gateway from the
// PAYER wallet; that KAS lands in the PAYEE wallet (both the operator's). Over time the payer
// drains and the payee accumulates (fragmented). This sweeps the whole loop back into ONE payer
// UTXO so the payer can always cover the priciest service — no manual funding. Internal transfers
// only (payer+payee -> payer); it never sends KAS outside the operator's wallets.
import fs from "node:fs";
import { createRequire } from "node:module";

const WASM = "/home/murr/kx402/vendor/kaspa-wasm32-sdk/nodejs/kaspa/kaspa.js";
const req = createRequire(WASM);
globalThis.WebSocket = req("/home/murr/kx402/node_modules/websocket").w3cwebsocket;
const k = req(WASM);
k.initConsolePanicHook?.();

const MIN_UTXO = BigInt(Math.round(Number(process.env.MIN_UTXO_KAS || "8") * 1e8)); // payer's largest must clear this
const FEE = 20000n;
const ts = () => new Date().toISOString();
const kas = (s) => (Number(s) / 1e8).toFixed(3);

const payerKey = fs.readFileSync(process.env.HOME + "/.config/kaspa-402-mainnet-payer.key", "utf8").trim();
const payeeKey = (fs.readFileSync(process.env.HOME + "/.config/k402-mainnet-settlement.env", "utf8")
  .match(/CHANNEL_PAYEE_KEY=([0-9a-fA-F]+)/) || [])[1];
if (!payeeKey) { console.error(ts(), "ERR no payee key"); process.exit(1); }

const payerPriv = new k.PrivateKey(payerKey);
const payeePriv = new k.PrivateKey(payeeKey);
const payerAddr = payerPriv.toAddress("mainnet").toString();
const payeeAddr = payeePriv.toAddress("mainnet").toString();
const amtOf = (e) => BigInt(e.amount ?? e.entry?.amount ?? 0);

let url;
for (const s of ["eric.kaspa.stream", "maxim.kaspa.stream", "jake.kaspa.green", "noah.kaspa.blue"]) {
  try { const r = await fetch(`https://${s}/v2/kaspa/mainnet/tls/wrpc/borsh`, { signal: AbortSignal.timeout(8000) }); if (r.ok) { url = (await r.json()).url; break; } } catch {}
}
const rpc = new k.RpcClient({ url, encoding: k.Encoding.Borsh, networkId: "mainnet" });
await rpc.connect({ timeoutDuration: 15000, retries: 1 });

const STATUS_FILE = process.env.HOME + "/.k402/rebalance-status.json";
const st = { ts: Math.floor(Date.now() / 1000), action: "error", minKas: Number(MIN_UTXO) / 1e8, payerLargestKas: null, payerTotalKas: null, payerUtxos: null, txid: null };

try {
  const { entries: payerUtxos } = await rpc.getUtxosByAddresses([payerAddr]);
  const payerLargest = payerUtxos.reduce((m, e) => (amtOf(e) > m ? amtOf(e) : m), 0n);
  const payerTotal = payerUtxos.reduce((s, e) => s + amtOf(e), 0n);
  st.payerLargestKas = Number(payerLargest) / 1e8;
  st.payerTotalKas = Number(payerTotal) / 1e8;
  st.payerUtxos = payerUtxos.length;
  console.log(ts(), `payer largest ${kas(payerLargest)} / total ${kas(payerTotal)} (${payerUtxos.length} utxos) | min ${kas(MIN_UTXO)}`);

  if (payerLargest >= MIN_UTXO) {
    st.action = "healthy";
    console.log(ts(), "healthy — no action");
  } else {
    const { entries: payeeUtxos } = await rpc.getUtxosByAddresses([payeeAddr]);
    const loopTotal = [...payerUtxos, ...payeeUtxos].reduce((s, e) => s + amtOf(e), 0n);
    if (loopTotal < MIN_UTXO) {
      st.action = "starved";
      console.error(ts(), `STARVED: loop total ${kas(loopTotal)} < min ${kas(MIN_UTXO)} — add KAS (or convert some earned USDC).`);
      process.exitCode = 2;
    } else {
      // Pick the FEWEST, LARGEST utxos that reach the target — skips dust (tiny utxos blow KIP-9 storage mass).
      const combined = [...payerUtxos, ...payeeUtxos].sort((a, b) => (amtOf(b) > amtOf(a) ? 1 : -1));
      const TARGET = MIN_UTXO + 50_000_000n; // min + 0.5 KAS buffer
      const sel = [];
      let acc = 0n;
      for (const e of combined) { sel.push(e); acc += amtOf(e); if (acc >= TARGET) break; }
      // Leave 0.2 KAS so the change output stays well above the storage-mass floor — a *tiny* change
      // output makes C/change_value blow the KIP-9 limit. 0.2 KAS change keeps storage mass ~0.
      const out = acc - 20_000_000n;
      console.log(ts(), `REBALANCE: sweeping ${sel.length} largest utxos (of ${combined.length}) -> one payer UTXO ~${kas(out)} KAS`);
      const { transactions } = await k.createTransactions({
        entries: sel, outputs: [{ address: payerAddr, amount: out }], changeAddress: payerAddr, priorityFee: FEE, networkId: "mainnet",
      });
      let txid;
      for (const tx of transactions) { tx.sign([payerPriv, payeePriv]); txid = String(await tx.submit(rpc)); }
      st.action = "rebalanced";
      st.txid = txid;
      console.log(ts(), `done — ${transactions.length} tx(s), final ${txid}`);
    }
  }
} finally {
  await rpc.disconnect();
  try {
    fs.mkdirSync(STATUS_FILE.replace(/\/[^/]+$/, ""), { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(st));
  } catch { /* status file is best-effort */ }
}
