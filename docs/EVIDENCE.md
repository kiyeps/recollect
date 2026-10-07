# Evidence

Everything here was produced on 2026-10-08 (WIB) against the deployed bot and the live Walrus
Memory relayer. No value below is estimated.

## 1. Wallet and agent

| Item | Value |
| --- | --- |
| Dedicated wallet created for Sessions | `0x071769d4a78183e520a8aade1124e5f7480acde33fb097e92ca4e4a39ea66c29` |
| Agent (Walrus Memory account id) | `0xf60c01805404c1e3f9fb896e492ff362c0b9a9e4527e8eb4bfa7ffe54afebde8` |
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

## 2. Blob count on mainnet

```bash
node tools/blob-count-proof.mjs
```

Output, verbatim from the run:

```
agent (MemWal account id): 0xf60c01805404c1e3f9fb896e492ff362c0b9a9e4527e8eb4bfa7ffe54afebde8
relayer: https://relayer.memory.walrus.xyz

namespace            indexed  onchain  restored  skipped  failed  truncated
recollect/profile         20        0         0        0       0      false
                     owner: 0xbfaadd8980b532c65ca09be4fdc9901c5ccafc1814f035502e526288aefd092f
recollect/notes            7        0         0        0       0      false
                     owner: 0xbfaadd8980b532c65ca09be4fdc9901c5ccafc1814f035502e526288aefd092f
recollect/log              0        0         0        0       0      false
                     owner: 0xbfaadd8980b532c65ca09be4fdc9901c5ccafc1814f035502e526288aefd092f

Recollect namespaces -- indexed: 27  on-chain: 0
Whole agent (all namespaces, incl. unrelated ones): 9620
```

Blobs written by this chatbot: **27** (20 in `recollect/profile`, 7 in `recollect/notes`).

Two things to read carefully in that table.

The count comes from the relayer's own namespace index for this account, read live through
`listNamespaces()` at the time of the run. It is the count the relayer holds for these namespaces.
The `onchain` column is `restore()`, which reports `total=0` for every namespace on this account
including a namespace holding 98 memories, and fails with `503` for the namespace holding 9485. That
discrepancy is documented as Bug 1 in `docs/FEEDBACK.md` and is not a claim about this chatbot.

The whole account holds 9620 memories across nine namespaces, because the same Walrus Memory account was
used for earlier work before this chatbot existed. The table above lists only the two namespaces this
chatbot writes to, plus the one it reserves. Cross-check:

```bash
node tools/restore-crosscheck.mjs
# 9485  default               ERROR Walrus Memory server error (503): upstream temporarily unavailable
#   98  openclaw              total=0 restored=0 skipped=0 failed=0
#   20  recollect/profile     total=0 restored=0 skipped=0 failed=0
#    7  recollect/notes       total=0 restored=0 skipped=0 failed=0
#    5  markov/facts          total=0 restored=0 skipped=0 failed=0
#    3  markov/state          total=0 restored=0 skipped=0 failed=0
#    2  sessions8-smoke        total=0 restored=0 skipped=0 failed=0
```

## 3. Blob ids returned at write time

Every write returns blob ids, which the bot prints as a receipt:

| Conversation | Facts written | Blob ids |
| --- | --- | --- |
| Session 1 | project name, timezone, answer-length preference | `hRrI0gOLYI`, `2XKZ-9jsvv`, `pJiqPsTl_m`, `Dzs8lg5H6f`, `eu-w5q3FCg`, `EBcR7NL6Vf` |
| Session 2 (after restart) | recall answers only | `6WMAApVIyx`, `3q7-nGJUgh`, `rYHWUNBucA`, `AW-MuHusYr` |

Blob ids are truncated to ten characters by the bot's own receipt line. Full transcripts are in
`docs/evidence/`.

## 4. The restart test

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

Reproduce it:

```bash
python3 tools/drive-conversation.py a      # session 1
systemctl --user restart recollect.service
python3 tools/drive-conversation.py b      # session 2, new process
```

## 5. What is not proven here

- The relayer's namespace index is the count source. Walrus Memory does not expose an independent
  on-chain enumeration of an account's blobs, and `restore()` does not currently produce one either
  (Bug 1). The count is read from the relayer the chatbot itself writes to.
- Memory is per bot, not per user. The deployed bot holds one account, so two users of one instance
  share one memory space. This repository ships that model, and the limitation is documented in
  `docs/ARCHITECTURE.md`.
- No memory has been read or written on behalf of any user other than the researcher's own test account.
