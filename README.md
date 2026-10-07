# Recollect

A Telegram chatbot whose memory lives on Walrus instead of on the machine answering you.

Live bot: [@RecollectMemoryBot](https://t.me/RecollectMemoryBot)

Built for Walrus Sessions 8 (Chatbots That Remember), Sept 18 to Oct 9 2026.

## The problem this solves

Most self-hosted chatbots keep conversation memory in a local file or a local database. That
memory dies with the container, it cannot be shared by two instances, and it disappears the
moment you move the bot to another host. The user has to re-introduce themselves every time the
process restarts.

Recollect moves every durable byte off the host. Facts about the user are written to Walrus
Memory on Sui mainnet, keyed to a Walrus Memory agent. The Node process is deliberately
disposable: it can be killed, redeployed or replaced by a second instance, and the next
conversation still opens with everything the user said last week.

## What it does

Recollect is a general personal-assistant bot. It is not tied to one topic: it remembers
identity, preferences, habits, projects and decisions, and it pulls the relevant ones back
before answering.

Three things make the memory do real work rather than decorate the conversation:

1. **Boot recall.** Before the first reply in a fresh process, the agent queries Walrus Memory
   for the user profile and the recent conversation trail, and injects what it finds into the
   system prompt. The opening message is therefore specific, not generic.
2. **Explicit tools.** The model can call `recall_memory` (search a namespace) and `save_memory`
   (persist one standalone fact) at any point in a turn.
3. **Post-turn capture.** After each answer, a second, cheaper model call extracts facts from the
   exchange that will still be true in a month, and writes them as individual blobs. This is the
   step that turns a stateless chat into a chat that remembers.

Everything else, including the chat history array and the boot snapshot, is in memory only and is
expected to be lost.

## Does it actually remember?

Yes, and the evidence is a process restart rather than a claim. The sequence below was run on the
deployed bot on 2026-10-08 (WIB).

**Session 1** (facts stated in conversation):

```
ME  > Proyek yang sedang aku bangun namanya Recollect, chatbot Telegram yang memorinya disimpan di Walrus.
BOT < Tercatat: proyekmu bernama Recollect, chatbot Telegram dengan memori di Walrus.
      [memory saved to Walrus: hRrI0gOLYI, 2XKZ-9jsvv]
```

**Then the service was restarted.** The process that holds the in-memory `history` array was
replaced (PID 342206 to PID 361332). Nothing about the previous conversation survived on the host.

**Session 2** (new process, new chat state):

```
ME  > Halo, kita baru mulai sesi baru. Apa yang kamu ingat tentang aku?
BOT < Halo. Yang aku ingat tentang kamu:
      - Security researcher, berbasis di Jakarta
      - Zona waktu GMT+7 (Jakarta)
      - Biasanya kerja dari jam 11 malam sampai 4 pagi
      - Suka kopi hitam tanpa gula
      - Lebih suka jawaban singkat, tanpa basa-basi
      - Tidak mau balasan beremoji
```

```
ME  > Kalau aku tanya soal pekerjaanku, apa yang kamu tahu?
BOT < Soal pekerjaanmu, yang tersimpan:
      - Kamu security researcher di Jakarta, kerja malam (23.00-04.00).
      - Proyek sampingan: Recollect, chatbot Telegram yang memorinya disimpan di Walrus.
      - Stack proyek itu Node.js dan SQLite.
      - Ada keputusan: semua memori chatbot dipindahkan dari SQLite ke Walrus.
```

Those facts were not in the process that answered. They were read back from Walrus Memory at boot.

Full transcripts, including the blob ids the relayer returned at write time, are in
`docs/evidence/`.

## How the pieces fit together

```
Telegram  ->  src/telegram.mjs  ->  src/agent.mjs  ->  src/tools.mjs  ->  src/memory.mjs  ->  Walrus Memory
                                        |                                      |
                                        +----> src/llm.mjs (any OpenAI-compatible endpoint)
```

| File | Role |
| --- | --- |
| `src/memory.mjs` | Wraps the MemWal SDK. Owns the namespace allowlist. |
| `src/tools.mjs` | The two tool schemas (`recall_memory`, `save_memory`) and their handlers. |
| `src/agent.mjs` | Boot recall, the tool loop, and the post-turn fact extraction. |
| `src/llm.mjs` | Minimal chat-completions client with a fallback chain and tolerant JSON parsing. |
| `src/telegram.mjs` | Bot API long polling, one agent per chat, `/memory` and `/trail` commands. |
| `src/cli.mjs` | The same agent over stdin, for people who do not want to create a bot. |

Memory is namespaced on purpose, so a chatbot cannot silently become an unauditable dump:

- `recollect/profile` - identity, preferences, habits
- `recollect/notes` - projects, decisions, plans
- `recollect/log` - reserved for per-conversation summaries

## Setup

Requires Node.js 20 or newer. No build step, no dependencies beyond the MemWal SDK.

```bash
git clone https://github.com/kiyeps/recollect.git
cd recollect
npm install

# 1. Create a Walrus Memory account and a delegate key at https://memory.walrus.xyz
#    Download the credentials file. It looks like:
#      {"delegatePrivateKey":"<64-hex>","accountId":"0x...","relayerUrl":"https://relayer.memory.walrus.xyz"}
mkdir -p ~/.memwal && mv ~/Downloads/credentials.json ~/.memwal/credentials.json
chmod 600 ~/.memwal/credentials.json

# 2. Configure
cp .env.example .env
$EDITOR .env    # LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, MEMWAL_CREDENTIALS

# 3a. Run the CLI channel (works immediately, no bot token needed)
node src/cli.mjs

# 3b. Or run the Telegram channel
#     Put a token from @BotFather in TELEGRAM_BOT_TOKEN first.
node src/telegram.mjs
```

Verify the memory footprint of your own agent at any time:

```bash
node tools/blob-count-proof.mjs
```

The CLI prints what it recalled on boot and the blob id of every write:

```
Recollect -- memory on Walrus. Recalled 6 profile fact(s), 0 trail entry(ies).
you> aku suka kopi hitam tanpa gula
   [memory:save_memory] {"text":"User suka kopi hitam tanpa gula.","namespace":"recollect/profile"}
recollect> Noted.
   [remembered 1 blob(s): hRrI0gOLYI]
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_BASE_URL` | required | Base URL of an OpenAI-compatible endpoint. |
| `LLM_API_KEY` | required | Key for that endpoint. |
| `LLM_MODEL` | required | Model id. |
| `LLM_MAX_TOKENS` | `900` | Reply budget per call. |
| `LLM_TIMEOUT_MS` | `120000` | Per-request timeout. Raise it for slow local models. |
| `LLM_FALLBACK_BASE_URL` / `LLM_FALLBACK_MODEL` / `LLM_FALLBACK_API_KEY` | empty | Second endpoint, used when the primary fails twice. |
| `MEMWAL_CREDENTIALS` | `~/.memwal/credentials.json` | Path to the Walrus Memory credentials file. |
| `TELEGRAM_BOT_TOKEN` | empty | Bot token. Required for the Telegram channel only. |
| `TELEGRAM_ALLOWED_USER_IDS` | empty | Comma-separated user ids allowed to talk to the bot. Empty means anyone. |
| `TELEGRAM_SHOW_EVENTS` | `1` | Set to `0` to hide the `[memory saved to Walrus: ...]` receipt. |
| `BOOT_RECALL_LIMIT` | `6` | How many profile memories are pulled at boot. |
| `MAX_WRITES_PER_TURN` | `4` | Upper bound on facts written per exchange. |

## What we ran

| Component | Value |
| --- | --- |
| LLM | DeepSeek V4 (`deepseek-v4.1-flash`) through an OpenAI-compatible gateway |
| Model family vs the event categories | DeepSeek, so not Anthropic and not OpenAI |
| Runtime | Node.js 24.18.0, no container |
| MemWal SDK | `@mysten-incubation/memwal` 0.1.8 |
| Relayer | `https://relayer.memory.walrus.xyz`, relayer version 0.1.0, API version 1.0.0 |
| Network | Sui mainnet |
| Channel | Telegram, long polling |

## Walrus Memory footprint

Read from the deployed agent on 2026-10-08 with `tools/blob-count-proof.mjs`:

| Item | Value |
| --- | --- |
| Agent (MemWal account id) | `0xf60c01805404c1e3f9fb896e492ff362c0b9a9e4527e8eb4bfa7ffe54afebde8` |
| `recollect/profile` | 20 blobs |
| `recollect/notes` | 7 blobs |
| `recollect/log` | 0 blobs, reserved |
| Blobs written by this chatbot | **27** |
| Dedicated Sessions wallet | `0x071769d4a78183e520a8aade1124e5f7480acde33fb097e92ca4e4a39ea66c29` |

The count above is the number of memories the Walrus Memory relayer holds for these namespaces,
read live through `listNamespaces()`. It is the writable evidence for the event requirement of at
least ten mainnet blobs. Note that the same MemWal account also carries unrelated namespaces from
earlier work; the table lists only what this chatbot wrote.

## Friction and feedback

Notes gathered while building this, including what the SDK does not give you yet, are in
`docs/FEEDBACK.md`. The short version: Walrus Memory gave us durable cross-process recall that
worked on the first try, and what it does not yet give us is any notion of a memory superseding
another memory. This chatbot handles that at read time.

## License

MIT. See `LICENSE`.
