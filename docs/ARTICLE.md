# I moved my chatbot's memory out of the process, and it stopped forgetting

A chatbot that remembers you is easy to fake. Keep the last fifty messages in a list, send them with
every request, and it looks like memory until the container restarts. I wanted the other thing: a chatbot whose
user facts survive being killed, moved to another host, or replaced by a second instance. That means the memory
cannot live in the process, and it cannot live in a database on the same box either. It has to live somewhere the
process can leave behind and come back to.

This is how I built it on Walrus Memory, and what changed when I did.

## What it does

Recollect (@RecollectMemoryBot on Telegram) is a personal assistant bot. You tell it things about yourself, and
it keeps them. Ask it a question a week later from a different machine and it still knows the answer.

The part that makes it a memory layer rather than a transcript is that it writes facts, not messages. When you say
"aku lebih suka jawaban singkat, tanpa basa-basi", it does not save that sentence as a message in a thread. It saves
the fact: "The user prefers short answers without small talk." One fact, one blob, standalone sentence, still true in
a month. When you say "proyekku namanya Recollect", it saves that as a separate blob in a different namespace.

Three namespaces hold everything:

- `recollect/profile` for identity, preferences and habits
- `recollect/notes` for projects, decisions and plans
- `recollect/log` reserved for per-conversation summaries

That split is not cosmetic. It decides which memories get pulled at boot, and it keeps the account readable instead
of turning it into one undifferentiated pile.

## Before memory

Before Walrus Memory, the bot was the usual shape. A `history` array in memory, capped at some number of turns, and
nothing on disk.

It worked well for exactly as long as the process stayed up. Then it didn't:

- Restart the service and the bot introduces itself to you again.
- Run two instances and they each know half of what you said.
- Move it to another host and the user facts stay behind.
- A long conversation pushes the early facts out of the window, so the things you said first are gone by the time they matter.

The failure is not dramatic. It is just a bot that is quietly worse than it looks, and every fix is local: a bigger
window, a file on disk, a database next to the app. Each fix moves the same problem one box further out.

## Wiring Walrus Memory

The integration is one dependency and one wrapper. `@mysten-incubation/memwal` is the SDK, and `src/memory.mjs`
is where the rest of the app talks to it, so no other file touches credentials.

```js
export const NS = Object.freeze({
  profile: "recollect/profile",
  notes: "recollect/notes",
  log: "recollect/log",
});

export async function recall(mem, query, namespace, limit = 5) {
  if (!ALL_NAMESPACES.includes(namespace)) throw new Error(`namespace not allowed: ${namespace}`);
  const r = await mem.recall({ query, limit, namespace });
  return (r.results || []).map((m) => ({ text: m.text, blob_id: m.blob_id }));
}

export async function rememberMany(mem, items) {
  for (const it of items) {
    if (!ALL_NAMESPACES.includes(it.namespace)) throw new Error(`namespace not allowed: ${it.namespace}`);
  }
  const r = await mem.rememberBulkAndWait(items.map((it) => ({ text: it.text, namespace: it.namespace })));
  return { succeeded: r.succeeded, failed: r.failed, results: r.results };
}
```

Two details in there are deliberate.

**The namespace allowlist.** The model never picks a namespace. It picks from three options I defined, and
anything else throws at the SDK boundary. A chatbot whose model chooses where to write ends up as an unauditable
dump with no way to answer "what did this bot store about me". The allowlist costs four lines and answers it.

**Bulk writes.** `rememberBulkAndWait` returns one blob id per fact. The bot tells you what it stored, and it can
show the ids. That receipt is also the cheapest possible test: if the blob ids change and the facts come back from
them, memory is doing real work.

Then there are the two places memory gets written.

The first is a tool. The model can call `save_memory` mid-turn when it decides something is worth keeping. It is
precise, and the model sometimes forgets to call it.

The second is a pass after the answer is delivered. A second, cheaper model call reads the exchange and extracts only
facts that will still be true in a month, then writes them. This is the step that catches what the tool missed.

Running both is deliberate. The two steps fail differently: the tool is precise but forgetful, the capture pass is
exhaustive but needs a filter. A missed tool call costs nothing when the capture pass runs anyway.

And there is a read before the first reply. `boot()` pulls the profile and the recent trail and injects them into the
system prompt, so the opening message is specific instead of generic. That single call is most of the visible difference
to a user.

## After memory

Nothing about the bot changed except where the facts live, and the behaviour changed completely.

**It survives a restart.** This is the test I ran on the deployed bot, and it is the whole point.

Session one, before the restart:

```
ME  > Proyek yang sedang aku bangun namanya Recollect, chatbot Telegram yang
      memorinya disimpan di Walrus.
BOT < Tercatat: proyekmu bernama Recollect, chatbot Telegram dengan memori di Walrus.
      [memory saved to Walrus: hRrI0gOLYI, 2XKZ-9jsvv]
```

Then I restarted the service, which replaced the process holding the in-memory history. Session two, from a
process that had nothing in memory:

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

Every one of those facts came out of Walrus Memory. The process that answered had never seen the conversation
that produced them and had no state of its own. I used the same trick I would use on any other memory layer: kill
the thing that claims to remember, then ask it something only the memory could know.

**It can say what it does not know.** Asked about client work, it answered that technical details of my job were not
in memory, and asked me to fill them in. A bot that invents an answer is worse than one that admits the gap, and this
one is limited by what is actually on chain.

**It notices when two memories disagree.** This one is not something I designed, it fell out of using it. I had stated a
name in an earlier session and a different one later. On the next boot the bot recalled both and asked which was correct,
before answering anything else:

```
BOT < Satu catatan: sebagian memori menyebut namamu "Celyn", sementara profil
      menyebut "Chovy". Mana yang benar?
```

That is honest behaviour, and it is also the clearest sign the memory is real. A stateless bot cannot notice a
contradiction, because it does not have two things to contradict.

## What it cost and what it did not fix

The footprint on mainnet, read live from the deployed agent:

| Item | Value |
| --- | --- |
| Agent | `0xf60c01805404c1e3f9fb896e492ff362c0b9a9e4527e8eb4bfa7ffe54afebde8` |
| Blobs written by this chatbot | 27 |
| Namespaces | profile, notes, log |

The LLM is DeepSeek V4 through an OpenAI-compatible gateway, for two reasons: it keeps the stack away from
the two providers everyone reaches for first, and the whole thing runs against a local model by changing one line of
config.

What the move does not fix is worth saying plainly. Walrus Memory stores facts as blobs, and a blob does not
supersede another blob. When a fact changes, both versions stay, and the application has to decide what to do about
it. This chatbot handles that at read time and asks the user. That is a reasonable answer for a personal assistant and
a bad answer for something that has to act without asking.

The second thing is per-user memory. This bot keeps one Walrus Memory account for the whole bot, so two users talking
to one instance share one memory space. Per-user deployments, or a per-user namespace suffix, would fix it. I shipped the
per-bot model because it is the one the deployed bot uses, and the honest description of it is a per-bot memory rather
than a per-user one.

## If you are building the same thing

Four things I would tell anyone starting this.

Keep the memory write small and the fact self-contained. "User prefers short answers" survives a year, a summary of a
conversation does not, and the second one is what turns memory into noise.

Write after the answer, not before. The reply is what the user waited for; the memory write is bookkeeping, and it should
never be in front of it.

Show the receipts while you build. Printing the blob id in the reply made every conversation a test, and it is how I found out
that the capture pass had written four facts I did not ask for on the first turn.

Test it by killing it. A memory layer that has never survived a restart has not been tested, and the test takes one command.

The code is at [github.com/kiyeps/recollect](https://github.com/kiyeps/recollect). The bot is live at
[@RecollectMemoryBot](https://t.me/RecollectMemoryBot). Notes on the integration, including what the SDK does not
give you yet, are in the repository under `docs/FEEDBACK.md`.
