# Feedback on Walrus Memory

Notes gathered while building and running Recollect, written for the Walrus Memory feedback form and
for issues on `github.com/MystenLabs/MemWal`.

Channel rule taken from the project's own `SECURITY.md`: functional bugs and feature requests belong in
GitHub issues, security vulnerabilities belong at `security@mystenlabs.com`. Everything below is functional.

Environment for every observation: `@mysten-incubation/memwal` 0.1.8, relayer
`https://relayer.memory.walrus.xyz` (relayer version 0.1.0, API version 1.0.0), Sui mainnet,
Node.js 24.18.0, Linux. Observed 2026-10-08.

## Bug 1: `restore()` reports zero on-chain blobs for namespaces that hold memories

What we expected: `restore(namespace)` to report how many of the namespace's blobs it found on chain,
which is what the result fields suggest (`total`, `restored`, `skipped`, `failed`, `truncated`, `owner`).

What happened: `total`, `restored` and `skipped` come back `0` for namespaces the relayer's own index
reports as populated, and the largest namespace fails with `503 Upstream temporarily unavailable`.

Steps to reproduce:

```bash
# 1. What the relayer index says the account holds
node -e "import('./src/memory.mjs').then(async m=>{const mem=m.createMemory(m.loadCredentials());
const ns=await mem.listNamespaces();
for(const n of ns.namespaces) console.log(n.memory_count, n.id);})"

# 2. What restore says about the same namespaces
node -e "import('./src/memory.mjs').then(async m=>{const mem=m.createMemory(m.loadCredentials());
for(const n of ['recollect/profile','recollect/notes','openclaw','default'])
console.log(n, JSON.stringify(await mem.restore(n,200)));})"
```

Observed:

| Namespace | `listNamespaces()` `memory_count` | `restore()` result |
| --- | --- | --- |
| `recollect/profile` | 20 | `total=0 restored=0 skipped=0 failed=0 truncated=false` |
| `recollect/notes` | 7 | `total=0 restored=0 skipped=0 failed=0 truncated=false` |
| `openclaw` | 98 | `total=0 restored=0 skipped=0 failed=0 truncated=false` |
| `default` | 9485 | `503 Upstream temporarily unavailable (truncated)` |

Why it matters: `restore()` looks like the only call that would let an application verify its own
on-chain footprint, or repair a local index after a loss. As it stands, a caller cannot tell a namespace that
holds nothing from a namespace whose on-chain page failed to enumerate, because both come back `0`. An application
that treated `restored: 0` as "nothing on chain" would be wrong about a namespace holding 98 blobs.

Related, and possibly the same root cause: the response omits `truncated` on some paths, which the SDK already
defaults to `false`, so "not known to be truncated" reads as "not truncated".

## Bug 2: recall surfaces superseded facts, with no way to say a fact replaced another

What we expected: one durable fact per thing, where a restated fact replaces the earlier one.

What happened: facts are append-only. Restating a fact writes a new blob and leaves the old one in place, so
recall returns both, at similar distance, with no ordering that identifies which is newer. Verified live: a session
stated "Celyn yang benar, Chovy itu panggilan orang luar". The next session, after a process restart, recalled
both names and asked which was correct. The process had no state of its own, so both came from Walrus Memory.

Steps to reproduce: state a fact, restate it differently in a later session, then ask the bot what it knows.
The reply lists both versions and asks the user to disambiguate.

Why it matters: a remembering chatbot has to reconcile contradictions, and the only tool it has is asking the user
again. A `supersedes` hint on write, or a recency score on recall, would let the application resolve it silently.

Improvement idea: return the write timestamp or a monotonic sequence per namespace in the recall hit, next to
`blob_id`. Nothing has to change on write. The application can then prefer the newest fact in a namespace, which
covers the common case, and still keep every blob on chain for audit.

## Improvement idea: a per-namespace read of the agent's own footprint

The submission gate for this event asks for the agent's blob count. Reading it means listing every namespace on
the account and summing `memory_count`. There is no call that answers "how many blobs has this account written in
this namespace", and given Bug 1 there is no working fallback. A cheap `stats(namespace)` returning the blob count
and bytes would close that, and it would also let a chatbot show the user its own storage footprint.

## Improvement idea: recovery from a lost index without re-reading every page

If the local index is lost, everything has to be re-read from the on-chain blob page, and `restore()` is the
only entry point. Bug 1 makes that path unusable for the largest namespace, so a lost index cannot currently be
rebuilt. A bounded, paginated restore with a status per page would make recovery possible to retry, and possible to
observe while it runs.

## What worked well

Durable cross-process recall worked on the first attempt. After a process restart that erased all in-memory state, the
chatbot recalled the user's city, timezone, working hours, drink preference, answer-length preference and project
stack, all read back from Walrus Memory. Bulk writes returned one blob id per fact, which made the chatbot's own
receipts meaningful. `listNamespaces()` was the only call that returned an accurate account of what the agent held, and
it is what made the count in this repository's README possible.
