# I moved my chatbot's memory out of the process, and it stopped forgetting

A chatbot that remembers you is easy to fake: keep the last fifty messages, resend them every turn, and it looks
like memory until the container restarts. I wanted the other thing, facts about a user that survive the process
being killed or the host being replaced. So the memory cannot live in the process, and a database on the same box
is a slower version of the same problem.

I built it on Walrus Memory, running DeepSeek V4 through an OpenAI-compatible gateway.

## What it does

Recollect ([@RecollectMemoryBot](https://t.me/RecollectMemoryBot)) is a personal assistant bot on Telegram. You tell
it things about yourself and it still knows them next week, from a different device.

The decision that matters: it stores facts, not messages. "aku lebih suka jawaban singkat" is not saved as a
transcript line. It is saved as "The user prefers short answers", one blob, and it goes to the project namespace
instead when the fact is about a project rather than a person. Standalone sentences survive; summaries turn memory
into noise.

## How the integration works

`@mysten-incubation/memwal` is the only dependency. `src/memory.mjs` wraps it so no other file touches credentials, and
it enforces one rule: the model never chooses where to write. Namespaces are built from the channel identity, not from
model output, which is what lets one bot serve several people without mixing them together:

```js
export function namespacesFor(userId) {
  const id = String(userId).replace(/[^0-9]/g, "");
  return Object.freeze({
    profile: `recollect/u${id}/profile`,   // identity, preferences, habits
    notes:   `recollect/u${id}/notes`,     // projects, decisions, plans
    log:     `recollect/u${id}/log`,       // per-conversation summaries
  });
}
```

Memory is read at three moments and written at two.

On the first message of a session, `boot()` recalls the profile and the recent trail into the system prompt. That
call is most of what a user notices, because the opening reply is specific instead of generic.

Mid-turn, the model can call `recall_memory` before answering something that depends on an earlier conversation, and
`save_memory` when it spots something durable. The tool pass is precise but forgetful.

So after the reply is delivered, a second pass extracts only facts that will still be true in a month, writes them in
bulk, and returns one blob id per fact. The two write paths fail differently on purpose: a missed tool call costs
nothing when the capture pass runs anyway.

## Before and after

Before, the bot was the usual shape: an in-memory history array, nothing on disk. Restart the service and it
introduces itself again. Run two instances and each knows half of what you said. The failure is not dramatic, it is
just a bot that is quietly worse than it looks.

After, I ran the only test that counts. Session one, fact stated:

```
ME  > Proyek yang sedang aku bangun namanya Recollect.
BOT < Tercatat. [memory saved to Walrus: hRrI0gOLYI, 2XKZ-9jsvv]
```

Then I restarted the service, which destroyed the process holding the history. Session two, new process, nothing in
memory:

```
ME  > Halo, kita baru mulai sesi baru. Apa yang kamu ingat tentang aku?
BOT < Yang aku ingat tentang kamu:
      - Security researcher, berbasis di Jakarta
      - Zona waktu GMT+7
      - Suka kopi hitam tanpa gula
      - Lebih suka jawaban singkat, tanpa basa-basi
```

Every line came out of Walrus Memory. The process answering had never seen the conversation that produced it.

It also notices contradictions, which I did not design and would not have predicted. After stating a different name in
a later session, the next boot recalled both versions and asked which was correct before answering anything else. A
stateless bot cannot spot a contradiction, because it does not have two things to contradict.

## Evidence of real use

The deployed bot serves three separate accounts. Each one gets its own memory space derived from the
channel identity rather than from anything the model chose, and each stated twelve facts: 20, 34 and 31 blobs
respectively, 112 in total across eight namespaces, every write returning a blob id the bot printed back. One bot
instance, three people, no mixing.

## Friction worth knowing about

Model and runtime, since the environment is where the friction shows up: Node.js 24, no framework,
`@mysten-incubation/memwal` 0.1.8, and DeepSeek V4 (`deepseek-v4.1-flash`) behind a self-hosted
OpenAI-compatible gateway. Nothing here is Anthropic or OpenAI.

Two things bit me in that setup. `restore()` returned `0` for 9 of the 11 namespaces on my account with no
error at all, while the namespace index reported the counts correctly, so I could not tell a namespace that
holds nothing from one whose page was never read. And there is no supersede semantics: a changed fact does not
replace the old one, so the application reconciles versions at read time. Both are written up in the
repository, including the mistake I made first time round, which was to read a rate-limited response as a zero.

Code: [github.com/kiyeps/recollect](https://github.com/kiyeps/recollect)
