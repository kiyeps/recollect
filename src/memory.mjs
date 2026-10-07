// Recollect -- memory layer on Walrus Memory.
// Wraps the MemWal SDK so the rest of the app never touches credentials directly.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemWal } from "@mysten-incubation/memwal";

// Namespaces this chatbot owns. Keeping them under one prefix makes the agent's
// footprint obvious on chain and keeps it away from other projects' namespaces.
export const NS = Object.freeze({
  profile: "recollect/profile", // durable facts about the user
  notes: "recollect/notes", // things the user asked to remember
  log: "recollect/log", // per-conversation summaries (the "last time" trail)
});

export const ALL_NAMESPACES = Object.values(NS);

export function loadCredentials(credsPath) {
  const p = credsPath || process.env.MEMWAL_CREDENTIALS || path.join(os.homedir(), ".memwal", "credentials.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!raw.delegatePrivateKey || !raw.accountId) {
    throw new Error(`credentials file ${p} must contain delegatePrivateKey and accountId`);
  }
  return raw;
}

export function createMemory(creds) {
  return MemWal.create({
    key: creds.delegatePrivateKey,
    accountId: creds.accountId,
    serverUrl: creds.relayerUrl || "https://relayer.memory.walrus.xyz",
  });
}

export async function recall(mem, query, namespace, limit = 5) {
  if (!ALL_NAMESPACES.includes(namespace)) throw new Error(`namespace not allowed: ${namespace}`);
  const r = await mem.recall({ query, limit, namespace });
  return (r.results || []).map((m) => ({
    text: m.text,
    blob_id: m.blob_id,
    distance: Number((m.distance ?? 0).toFixed(4)),
  }));
}

export async function remember(mem, text, namespace) {
  if (!ALL_NAMESPACES.includes(namespace)) throw new Error(`namespace not allowed: ${namespace}`);
  const r = await mem.rememberAndWait(text, namespace);
  return { blob_id: r.blob_id, namespace: r.namespace };
}

export async function rememberMany(mem, items) {
  for (const it of items) {
    if (!ALL_NAMESPACES.includes(it.namespace)) throw new Error(`namespace not allowed: ${it.namespace}`);
  }
  const r = await mem.rememberBulkAndWait(items.map((it) => ({ text: it.text, namespace: it.namespace })));
  return {
    succeeded: r.succeeded,
    failed: r.failed,
    results: (r.results || []).map((x) => ({ status: x.status, blob_id: x.blob_id, namespace: x.namespace })),
  };
}

export async function health(mem) {
  return mem.health();
}
