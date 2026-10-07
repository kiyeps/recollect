# Evidence

Everything here was produced on 2026-10-08 (WIB) against the deployed bot and the live Walrus
Memory relayer. No value below is estimated.

## 1. Wallet and agent

| Item | Value |
| --- | --- |
| Dedicated wallet created for Sessions | `0x071769d4a78183e520a8aade1124e5f7480acde33fb097e92ca4e4a39ea66c29` |
| Agent (Walrus Memory account id) | `0xf60c01805404c1e3f9fb896e492ff362c0b9a9e4527e8eb4bfa7ffe54afebde8` |
| `MEMWAL_AGENT_ID` (delegate key public part) | `0xcf7f9ea27c97d2dc628b68ad7be523c72af55b0bb7b4024ab6d9aaa3fec5f2ce` |
| Relayer | `https://relayer.memory.walrus.xyz` (relayer version 0.1.0, API version 1.0.0) |
| SDK | `@mysten-incubation/memwal` 0.1.8 |
| Network | Sui mainnet |
| Channel | Telegram, long polling |

Agent read:

```bash
sui client object 0xf60c01805404c1e3f9fb896e492ff362c0b9a9e4527e8eb4bfa7ffe54afebde8
# objType 0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5::account::MemWalAccount
# owner 0xbfaadd8980b532c65ca09be4fdc9901c5ccafc1814f035502e526288aefd092f
```

The delegate key used by this bot is one of seven on the account, labelled `Web App` on chain. Its
`public_key` is `1V5TZT9QgE4IyzwGf2N3DSnogmuIJ1RXNCvPlVJ/rhE=` (Ed25519, base64) and its
`sui_address` is the `MEMWAL_AGENT_ID` in the table above. Both were read off the account object, not
copied from a dashboard.

## 2. Blob count on mainnet

```bash
node tools/blob-count-proof.mjs
```

Output, verbatim from the run the submission is based on:

```
agent (MemWal account id): 0xf60c01805404c1e3f9fb896e492ff362c0b9a9e4527e8eb4bfa7ffe54afebde8
relayer: https://relayer.memory.walrus.xyz

namespace                          indexed   storage
  default                               9485   3621679
  openclaw                                98     38868
* recollect/u5332246514/profile           29      9486
* recollect/u5016891236/profile           25      8258
* recollect/profile                       20      6695
* recollect/u6194195500/profile           14      4687
* recollect/notes                          7      2607
* recollect/u6194195500/notes              6      2091
* recollect/u5016891236/notes              6      2055
  markov/facts                             5      3000
* recollect/u5332246514/notes              5      1660
  markov/state                             3      3745
  sessions8-smoke                          2       714
  s8-temp-audit                            0         0
  s8-idempotency-probe                     0         0

This agent's namespaces (recollect/*): 8 spaces, 112 blobs
Whole agent (all namespaces, incl. unrelated ones): 9705
```

Blobs written by this chatbot: **112**, in 8 namespaces. The `default`, `openclaw`, `markov/*` and
`s8-*` spaces belong to earlier work on the same account and are listed so the sum can be checked.

## 3. Three users, each with its own memory space

Three separate Telegram accounts used the deployed bot, one session each, twelve stated facts per
session. The user id comes from the channel and is what the namespaces are built from, so the three
spaces below are not an allocation the bot chose, they are a function of who was talking.

| Telegram user id | Persona used in the session | Facts stated | Blobs written |
| --- | --- | --- | --- |
| `6194195500` | Celyn | 12 | 20 (14 profile, 6 notes) |
| `5332246514` | Riku | 12 | 34 (29 profile, 5 notes) |
| `5016891236` | Nia | 12 | 31 (25 profile, 6 notes) |

Sessions are recorded in `docs/evidence/facts-a-*.json`, `facts-b-*.json`, `facts-c-*.json`, one turn
per line with the reply and the blob ids the bot printed back. The blob count column is read from
`listNamespaces()` per namespace, not from the session files.

Handles are left out of this document on the account owner's instruction; the numeric ids are what
the namespaces are derived from and are enough to re-read every space above.

## 4. Blob ids returned at write time

Every write returns blob ids, which the bot prints as a receipt:

| Conversation | Facts written | Blob ids |
| --- | --- | --- |
| Session 1 | project name, timezone, answer-length preference | `hRrI0gOLYI`, `2XKZ-9jsvv`, `pJiqPsTl_m`, `Dzs8lg5H6f`, `eu-w5q3FCg`, `EBcR7NL6Vf` |
| Session 2 (after restart) | recall answers only | `6WMAApVIyx`, `3q7-nGJUgh`, `rYHWUNBucA`, `AW-MuHusYr` |
| Per-user sessions | 36 facts across three users | see the `facts-*.json` transcripts |

Blob ids are truncated to ten characters by the bot's own receipt line.

## 5. The restart test

| Step | Value |
| --- | --- |
| Process before | PID 342206 |
| Action | `systemctl --user restart recollect.service` |
| Process after | PID 361332 |
| In-memory chat history | Lost, by design, never written anywhere |
| Facts recalled after | City, timezone, working hours, drink preference, answer-length preference, project stack, migration decision |

Transcripts:

- `docs/evidence/conversation-a-1791395844.json` (session 1, five turns)
- `docs/evidence/conversation-b-1791395971.json` (session 2, after the restart, two turns)
- `docs/evidence/conversation-ping-1791396115.json` (liveness check after the code change)

That counts as the honest test of the claim, because the counters cannot be used for it: see the
`restore()` note below.

## 6. `restore()` was not usable as a second source, and our first reading of it was wrong

`restore(namespace, limit)` returned `total=0, restored=0, skipped=0` with no error for nine of the
eleven namespaces on the account, including one the index reports as holding 98 memories, and
returned 99 against 9485 and 1 against 14 for the other two. It also returned HTTP 503 for one
namespace on one pass, and HTTP 429 on repeated calls with no `Retry-After`.

Our first pass at this fired the calls back to back, counted the 429s as zeros, and concluded
"total=0 for every namespace". That was an instrumentation error on our side and is corrected here.
The serialised run with a 25 second gap is `tools/restore-probe.mjs`, and its raw rows are in
`docs/evidence/restore-probe-*.json`. The finding is written up as Bug 1 in `docs/FEEDBACK.md`.

## 7. What is not proven here

- The blob count comes from the relayer's namespace index, read through `listNamespaces()`. Walrus
  Memory does not expose an independent on-chain enumeration of an account's blobs, and `restore()`
  does not currently produce one either. The count is read from the relayer the chatbot itself
  writes to.
- The three sessions above are twelve facts each, run in one sitting. That demonstrates three users
  with their own spaces and their own memories; it is not a claim that the bot has been in daily use
  by three people for weeks.
- No memory has been read or written on behalf of any user other than the account owner's own test
  accounts.
- The latency figures in the transcripts (30 to 70 seconds per turn) are with the capture pass
  enabled, on a self-hosted model. They are not a benchmark of the memory layer.
