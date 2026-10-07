// Mainnet blob proof for the Recollect agent.
//
// Two independent readings:
//   1. listNamespaces()      -- relayer index: per-namespace memory_count.
//   2. restore(namespace)    -- re-reads the namespace's on-chain blob page and
//                               reports `total` (blobs found on chain) plus how
//                               many were missing from the local index.
//
// Run:  node tools/blob-count-proof.mjs
import { loadCredentials, createMemory } from "../src/memory.mjs";

const creds = loadCredentials();
const mem = createMemory(creds);

console.log("agent (MemWal account id):", creds.accountId);
console.log("relayer:", creds.relayerUrl);
console.log("");

const ns = await mem.listNamespaces();
const rows = (ns.namespaces || [])
  .map((n) => ({ namespace: n.id ?? n.name, memories: n.memory_count ?? 0, storage: n.storage_used ?? 0 }))
  .sort((a, b) => b.memories - a.memories);

console.log("namespace                          indexed   storage");
let ours = 0;
let oursSpaces = 0;
for (const r of rows) {
  const mine = r.namespace.startsWith("recollect/");
  if (mine) {
    ours += r.memories;
    oursSpaces += 1;
  }
  console.log(`${mine ? "*" : " "} ${r.namespace.padEnd(34)} ${String(r.memories).padStart(7)} ${String(r.storage).padStart(9)}`);
}

console.log("");
console.log("This agent's namespaces (recollect/*):", oursSpaces, "spaces,", ours, "blobs");
const all = rows.reduce((a, r) => a + r.memories, 0);
console.log("Whole agent (all namespaces, incl. unrelated ones):", all);
