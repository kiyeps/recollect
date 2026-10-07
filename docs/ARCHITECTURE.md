# Architecture

Recollect is deliberately small. The interesting part is not the code, it is where the state lives.

## State

| State | Where it lives | Survives a restart |
| --- | --- | --- |
| Facts about the user | Walrus Memory, `recollect/u<userId>/profile` and `recollect/u<userId>/notes` | Yes |
| Conversation trail | Walrus Memory, `recollect/u<userId>/log` | Yes |
| Current chat history | In-memory array in `src/agent.mjs` | No |
| Boot snapshot | In-memory object in `src/agent.mjs` | No |
| Telegram chat registry | In-memory Map in `src/telegram.mjs`, keyed by user id | No |
| Credentials | `~/.memwal/credentials.json`, never in the repo | n/a |

Nothing above the line is expected to survive. Losing the process loses the current turn's
context, and that is the point: the next process rebuilds context from Walrus in `boot()`.

## Write path

Two writes exist, and they are different on purpose.

1. **Tool driven.** The model decides mid-turn that a statement is durable and calls
   `save_memory`. This is one blob, written immediately, and the agent sees the blob id in the
   tool result.
2. **Capture driven.** After the answer is delivered, `capture()` makes a second, cheaper model
   call whose only job is to extract facts that will still be true in a month, and writes up to
   `MAX_WRITES_PER_TURN` of them in one bulk call.

The split exists because the two failure modes are different. Tool writes are precise but the model
forgets to call the tool. Capture is exhaustive but needs a filter, which is what the extraction
prompt is for. Running both means a missed tool call is recovered in the same turn.

## Read path

`boot()` runs before the first reply and pulls two things: profile memories for a broad identity
query, and recent trail entries. Both are injected into the system prompt as plain text, so the model
sees the user's context before it sees the user's first message.

Inside a turn the model can also call `recall_memory` with a narrower query and a specific namespace.

## Namespace policy

`recall_memory` and `save_memory` both validate the namespace against the allowlist in
`src/memory.mjs` and throw on anything else. The allowlist is not a list of names the model can pick
from: `namespacesFor(userId)` derives the three namespaces for one user from the channel identity,
and the tool schema handed to the model contains only those three. The model cannot invent a
namespace, and a prompt-injected instruction to write somewhere unusual fails at the SDK boundary
rather than on chain.

This is the one place where the design is deliberately rigid. An agent that can write anywhere
becomes an unauditable memory dump with no way to answer "what did this bot store".

## Model

The LLM is any OpenAI-compatible endpoint. The deployed bot runs DeepSeek V4 (`deepseek-v4.1-flash`)
through a gateway, which is a deliberate choice: it keeps the submission outside the Anthropic and OpenAI
families, and it means the whole stack can run against a local model.

`src/llm.mjs` has no SDK dependency. It posts to `/chat/completions`, strips the SSE terminator that
some routers append to non-streaming responses, retries each endpoint twice, and falls back to a second
endpoint if configured.

## Channels

Both channels call the same `createAgent`. The Telegram channel keys its in-memory registry by user
id, not by chat id, and builds one agent per user with that user's namespaces. Two people talking to
one bot instance therefore write to two separate memory spaces. The first version of this repository
keyed the registry by chat and wrote every user into one shared namespace pair, which meant a group
chat could mix two people's facts into a single space; the split above is what replaced it.

The identity used for the namespace comes from the channel, never from model output. A user id the
channel does not provide is a hard error rather than a fallback to a shared space, because a silent
fallback is how memory ends up in the wrong place.
