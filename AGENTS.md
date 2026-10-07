# AGENTS.md

## Overview

Recollect is a Telegram chatbot whose durable memory lives on Walrus Memory (Sui mainnet) rather
than on the host. Plain Node.js ESM, no build step, no framework. The only runtime dependency is
`@mysten-incubation/memwal`. Node.js 20 or newer. Package manager: npm.

## Commands

```bash
npm install                                  # the only dependency
node src/cli.mjs                             # CLI channel (stdin), no bot token needed
node src/telegram.mjs                        # Telegram channel (needs TELEGRAM_BOT_TOKEN)
node tools/blob-count-proof.mjs               # read the agent's blob count and namespaces
python3 tools/drive-conversation.py a         # talk to the live bot and save a transcript
python3 tools/drive-conversation.py ping      # one message, for a quick liveness check
```

There is no test suite and no linter configured. Verification is the live check above: send a
message, then confirm the reply plus the `[memory saved to Walrus: ...]` receipt. Restarting the
process and asking again is the memory test.

## Conventions

- ESM everywhere, `.mjs`, named exports, no default exports.
- Namespaces are never taken from model output. They are validated against the allowlist in
  `src/memory.mjs` and anything else throws:

```js
export const NS = Object.freeze({
  profile: "recollect/profile",
  notes: "recollect/notes",
  log: "recollect/log",
});
```

- Every statement about the user that is worth keeping is one blob, written as a standalone sentence.
- Secret-looking literals are never written inline. Auth headers are assembled from parts, because a
  file writer that redacts `Authorization` style strings can silently corrupt a literal.
- All code, comments, docs and log lines are English. Only bot replies follow the user's language.

## Boundaries

- **NEVER** commit `.env` or `~/.memwal/credentials.json`. Both are gitignored, and the delegate key
  and account id are read from the environment or from disk at runtime only.
- **NEVER** invent a namespace string or hardcode one outside `NS`.
- **NEVER** treat the in-memory `history` array as durable storage. Anything that must survive a
  restart belongs on Walrus.
- **IMPORTANT**: writes cost a relayer round trip. Keep `MAX_WRITES_PER_TURN` small and write facts,
  not transcripts.
- **IMPORTANT**: the bot token is a credential. Do not log it, and do not print request headers.

## Dependencies

- `@mysten-incubation/memwal` `^0.1.8`, the Walrus Memory SDK: recall, remember, bulk write,
  namespace listing, health.

Nothing else. `src/llm.mjs` uses the global `fetch` and `src/telegram.mjs` speaks the Bot API directly,
so there is no HTTP client and no Telegram library to keep current.

## Config

`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` are required. `LLM_MAX_TOKENS`, `LLM_TIMEOUT_MS`,
`BOOT_RECALL_LIMIT`, `MAX_WRITES_PER_TURN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`,
`TELEGRAM_SHOW_EVENTS`, `MEMWAL_CREDENTIALS` are optional. See `.env.example` for the full list and
the credential file shape. Placeholders only in anything committed.

## Error Handling

Every recall and every write is wrapped. A failed recall returns an empty list rather than killing the
turn, and a failed write is reported in the reply as `[remember failed: ...]` without discarding the answer
the user already earned. The LLM client retries each endpoint twice, then moves to the fallback endpoint,
and the last error is re-raised only if the whole chain fails. Telegram polling errors log one line and
retry after three seconds.

## Troubleshooting

- `llm ... 401` or `403`: the key in `.env` is wrong for that base URL. A key from one gateway sent to
  another gateway is the usual cause.
- `Expected property name or '}'` from the LLM client: the endpoint returned HTML or an SSE frame, not JSON.
  Check `LLM_BASE_URL` points at a chat-completions API and not at a dashboard.
- Every reply costs 60 to 90 seconds: `BOOT_RECALL_LIMIT` and the model are fine, the endpoint is slow.
  Raise `LLM_TIMEOUT_MS` or point at a faster model.
- `[remember failed: ...]`: inspect the relayer message. `503` means the relayer is briefly down and the
  next turn usually succeeds; a `401` means the delegate key does not belong to that account id.
- Bot silent in Telegram but the CLI works: the token is wrong, or `TELEGRAM_ALLOWED_USER_IDS` does not
  contain your user id.
