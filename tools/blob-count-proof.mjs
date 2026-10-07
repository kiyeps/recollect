// Mainnet blob proof for the Recollect agent.
//
// Two independent readings:
//   1. listNamespaces()      -- relayer index: per-namespace memory_count.
//   2. restore(namespace)    -- re-reads the namespace's on-chain blob page and
//                               reports `total` (blobs found on chain) plus how
//                               many were missing from the local index.
//
// Run:  node tools/blob-count-proof.mjs
import { loadCredentials, createMemory, ALL_NAMESPACES } from "../src/memory.mjs";

const creds = loadCredentials();
const mem = createMemory(creds);

console.log("agent (MemWal account id):", creds.accountId);
console.log("relayer:", creds.relayerUrl);
console.log("");

const ns = await mem.listNamespaces();
const index = new Map((ns.namespaces || []).map((n) => [n.id ?? n.name, n.memory_count ?? 0]));

console.log("namespace            indexed  onchain  restored  skipped  failed  truncated");
let indexed = 0;
let onchain = 0;
for (const namespace of ALL_NAMESPACES) {
  let r = {};
  try {
    r = await mem.restore(namespace, 200);
  } catch (err) {
    console.log(`${namespace.padEnd(20)} ${String(index.get(namespace) ?? 0).padStart(7)}  restore failed: ${String(err.message).slice(0, 60)}`);
    continue;
  }
  const idx = index.get(namespace) ?? 0;
  indexed += idx;
  onchain += r.total ?? 0;
  console.log(
    `${namespace.padEnd(20)} ${String(idx).padStart(7)}  ${String(r.total ?? 0).padStart(7)}  ` +
      `${String(r.restored ?? 0).padStart(8)}  ${String(r.skipped ?? 0).padStart(7)}  ` +
      `${String(r.failed ?? 0).padStart(6)}  ${String(r.truncated ?? false).padStart(9)}`
  );
  if (r.owner) console.log(`${" ".repeat(20)} owner: ${r.owner}`);
}

console.log("");
console.log("Recollect namespaces -- indexed:", indexed, " on-chain:", onchain);
const all = (ns.namespaces || []).reduce((a, n) => a + (n.memory_count ?? 0), 0);
console.log("Whole agent (all namespaces, incl. unrelated ones):", all);
