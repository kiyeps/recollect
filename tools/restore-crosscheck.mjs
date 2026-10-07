// Cross-check the restore path itself: does restore() ever report on-chain blobs?
// If a namespace with a large index also reports total 0, the zero for the
// Recollect namespaces is a relayer-side property, not a Recollect property.
import { loadCredentials, createMemory } from "../src/memory.mjs";

const mem = createMemory(loadCredentials());
const ns = await mem.listNamespaces();
const rows = (ns.namespaces || [])
  .map((n) => ({ namespace: n.id ?? n.name, memories: n.memory_count ?? 0 }))
  .sort((a, b) => b.memories - a.memories);

for (const row of rows) {
  if (row.memories === 0) continue;
  let r = {};
  let err = null;
  try {
    r = await mem.restore(row.namespace, 200);
  } catch (e) {
    err = String(e.message).slice(0, 80);
  }
  const verdict = err ? `ERROR ${err}` : `total=${r.total} restored=${r.restored} skipped=${r.skipped} failed=${r.failed}`;
  console.log(`${String(row.memories).padStart(6)}  ${row.namespace.padEnd(20)}  ${verdict}`);
}
