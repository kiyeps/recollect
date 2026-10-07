// Recollect -- memory layer on Walrus Memory.
// Wraps the MemWal SDK so the rest of the app never touches credentials directly.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemWal } from "@mysten-incubation/memwal";

// Shared namespaces, kept so memories written before the per-user split stay readable.
export const NS = Object.freeze({
  profile: "recollect/profile", // durable facts about the user
  notes: "recollect/notes", // things the user asked to remember
  log: "recollect/log", // per-conversation summaries (the "last time" trail)
});

// Per-user namespaces. Memory belongs to the person talking, not to the bot, so one
// instance can serve several people without mixing them together. The id is ours, taken
// from the channel identity, never from model output.
export function namespacesFor(userId) {
  const id = String(userId).replace(/[^0-9]/g, "");
  if (!id) throw new Error(`invalid user id: ${userId}`);
  return Object.freeze({
    profile: `recollect/u${id}/profile`,
    notes: `recollect/u${id}/notes`,
    log: `recollect/u${id}/log`,
  });
}

const ALLOWED = /^recollect\/(u[0-9]+\/)?(profile|notes|log)$/;

export function assertNamespace(namespace) {
  if (!ALLOWED.test(String(namespace))) throw new Error(`namespace not allowed: ${namespace}`);
  return namespace;
}

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
  assertNamespace(namespace);
  const r = await mem.recall({ query, limit, namespace });
  return (r.results || []).map((m) => ({
    text: m.text,
    blob_id: m.blob_id,
    distance: Number((m.distance ?? 0).toFixed(4)),
  }));
}

export async function remember(mem, text, namespace) {
  assertNamespace(namespace);
  const r = await mem.rememberAndWait(text, namespace);
  return { blob_id: r.blob_id, namespace: r.namespace };
}

export async function rememberMany(mem, items) {
  for (const it of items) {
    assertNamespace(it.namespace);
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
