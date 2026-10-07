# Feedback on Walrus Memory

Notes gathered while building and running Recollect, written for the Walrus Memory feedback form and
for issues on `github.com/MystenLabs/MemWal`.

Channel rule taken from the project's own `SECURITY.md`: functional bugs and feature requests belong in
GitHub issues, security vulnerabilities belong at `security@mystenlabs.com`. Everything below is functional.

Environment for every observation: `@mysten-incubation/memwal` 0.1.8, relayer
`https://relayer.memory.walrus.xyz` (relayer version 0.1.0, API version 1.0.0), Sui mainnet,
Node.js 24.18.0, Linux. Observed 2026-10-08.

## Bug 1: `restore()` returns 0 for most namespaces and no error, so it cannot verify anything

What we expected: `restore(namespace)` to report what it found for the namespace on chain, which is
what the result fields suggest (`total`, `restored`, `skipped`, `failed`, `truncated`, `owner`).

What happened: on a serialised run with a 25 second gap between calls, `total`, `restored` and
`skipped` come back `0` for nine of eleven namespaces, including one the index reports as holding 98
memories, and the two namespaces that do return a number return far less than the index says.

Steps to reproduce:

```bash
# serialised on purpose: back to back calls start returning HTTP 429
node tools/restore-probe.mjs
```

Observed, one run, `truncated` false everywhere:

| Namespace | `listNamespaces()` `memory_count` | `restore()` result |
| --- | --- | --- |
| `openclaw` | 98 | `total=0 restored=0 skipped=0 failed=0` |
| `default` | 9485 | `total=99 restored=0 skipped=99 failed=0` |
| `recollect/profile` | 20 | `total=0 restored=0 skipped=0 failed=0` |
| `recollect/u6194195500/profile` | 14 | `total=1 restored=0 skipped=1 failed=0` |
| `recollect/notes` | 7 | `total=0 restored=0 skipped=0 failed=0` |
| `recollect/u6194195500/notes` | 6 | `total=0 restored=0 skipped=0 failed=0` |
| `markov/facts` | 5 | `total=0 restored=0 skipped=0 failed=0` |
| `markov/state` | 3 | `total=0 restored=0 skipped=0 failed=0` |
| `sessions8-smoke` | 2 | `total=0 restored=0 skipped=0 failed=0` |
| `s8-temp-audit` | 0 | `total=0 restored=0 skipped=0 failed=0` |
| `s8-idempotency-probe` | 0 | `total=0 restored=0 skipped=0 failed=0` |

The last row above the empties is the clearest one: those 14 memories were written minutes earlier by
this same client through `rememberAndWait` and `rememberBulkAndWait`, and the writes returned blob
ids, so the client believes they landed. The index then counted 14 and `restore()` found 1.

The same call is also inconsistent between runs: on one pass `default` raised
`503 Upstream temporarily unavailable`, and on the next pass the same namespace returned `total=99`.
Issued back to back, later calls raise `429 Rate limit exceeded` (layer `delegate`) with no
`Retry-After`; a ten call loop produced four answers and six 429s.

Why it matters: `restore()` looks like the only call that would let an application verify its own
on-chain footprint, or repair a local index after a loss. As it stands, a caller cannot tell a
namespace that holds nothing from one whose page failed to enumerate, and cannot tell a partial
restore from a complete one. An application that read `restored: 0` as "nothing on chain" would be
wrong about a namespace holding 98 blobs.

Also worth noting: the response omits `truncated` on some paths, and the SDK defaults it to `false`,
so "not known to be truncated" reads as "not truncated".

Method note, because we got this wrong once: our first pass fired the calls back to back, treated
HTTP 429 responses as zero, and reported "restore returns 0 for every namespace". That was an
instrumentation artefact. The table above is the serialised run, with 429s retried after a backoff
rather than counted.

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
only entry point. Bug 1 makes that path unusable: it reports 0 for most namespaces with no error, so a client
cannot tell whether a page was read and empty or never read at all. A bounded, paginated restore with a status per
page would make recovery possible to retry, and possible to observe while it runs.

## What worked well

Durable cross-process recall worked on the first attempt. After a process restart that erased all in-memory state, the
chatbot recalled the user's city, timezone, working hours, drink preference, answer-length preference and project
stack, all read back from Walrus Memory. Bulk writes returned one blob id per fact, which made the chatbot's own
receipts meaningful. `listNamespaces()` was the only call that returned an accurate account of what the agent held, and
it is what made the count in this repository's README possible.
