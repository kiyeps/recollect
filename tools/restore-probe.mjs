// Careful restore() probe.
//
// An earlier pass at this was instrumented badly: calls were fired back to back, and most came
// back as HTTP 429 "Rate limit exceeded" (layer: delegate). Reading those as "restore reports
// zero" was wrong, so this version serialises the calls, backs off on 429, and records the
// verbatim outcome per namespace so the reading can be judged instead of assumed.
import { writeFileSync } from "node:fs";
import { loadCredentials, createMemory } from "../src/memory.mjs";

const GAP_MS = Number(process.env.PROBE_GAP_MS || 25000);
const ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function classify(err) {
  const s = String(err && err.message ? err.message : err);
  if (s.includes("429") || /rate limit/i.test(s)) return "RATE_LIMIT";
  if (s.includes("503") || /upstream/i.test(s)) return "UPSTREAM";
  return "ERROR";
}

const creds = loadCredentials();
const mem = createMemory(creds);

console.log("agent:", creds.accountId);
const ns = await mem.listNamespaces();
const list = (ns.namespaces || []).map((n) => ({ id: n.id ?? n.name, indexed: n.memory_count ?? 0 }));

const rows = [];
for (const { id, indexed } of list) {
  let outcome = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const r = await mem.restore(id, 200);
      outcome = {
        kind: "OK",
        total: r.total ?? null,
        restored: r.restored ?? null,
        skipped: r.skipped ?? null,
        failed: r.failed ?? null,
        truncated: r.truncated ?? null,
        attempt,
      };
      break;
    } catch (e) {
      const kind = classify(e);
      outcome = { kind, message: String(e.message || e).slice(0, 160), attempt };
      if (kind === "RATE_LIMIT" && attempt < ATTEMPTS) {
        console.log(`  ${id}: 429, backing off 45s (attempt ${attempt})`);
        await sleep(45000);
        continue;
      }
      break;
    }
  }

  rows.push({ namespace: id, indexed, outcome });
  const o = outcome;
  const detail = o.kind === "OK"
    ? `total=${o.total} restored=${o.restored} skipped=${o.skipped} failed=${o.failed} truncated=${o.truncated}`
    : `${o.kind} ${o.message}`;
  console.log(`  ${String(indexed).padStart(5)}  ${id.padEnd(32)} ${detail}`);
  await sleep(GAP_MS);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = `evidence/restore-probe-${stamp}.json`;
writeFileSync(out, JSON.stringify({ gapMs: GAP_MS, attempts: ATTEMPTS, account: creds.accountId, rows }, null, 2));
console.log(`\nwritten: ${out}`);
