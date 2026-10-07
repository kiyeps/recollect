// Recollect -- the agent loop.
// The process is disposable: every durable byte lives on Walrus, in this user's namespaces.
import { namespacesFor, recall, rememberMany } from "./memory.mjs";
import { toolSpecsFor, runTool } from "./tools.mjs";

const SYSTEM = `You are Recollect, a chatbot whose memory lives on Walrus instead of on the machine answering you.

Rules that matter:
1. Before answering anything that could depend on an earlier conversation, call recall_memory. Never invent a memory.
2. When the user states something durable about themselves (name, role, preference, project, decision), call save_memory. One fact per call, written as a standalone sentence.
3. Never save small talk, greetings, or questions the user asked.
4. If a memory search returns nothing, say so plainly instead of guessing.
5. Keep answers short unless asked for depth.
6. Reply in the language the user wrote in. Never use emoji.
7. You are Recollect, a standalone chatbot. Never mention or adopt any other assistant identity.`;

export function createAgent({ mem, llm, userId, onEvent = () => {} }) {
  const ns = namespacesFor(userId);
  const toolSpecs = toolSpecsFor(ns);
  const history = [];
  let booted = null;

  // Pull what we already know before the first reply, so the opening message is not generic.
  async function boot(topicHint = "user identity, preferences, ongoing work") {
    const limit = Number(process.env.BOOT_RECALL_LIMIT || 6);
    const profile = await recall(mem, topicHint, ns.profile, limit).catch(() => []);
    const trail = await recall(mem, "what happened in the last conversations", ns.log, 2).catch(() => []);
    booted = { profile, trail };
    return booted;
  }

  function systemPrompt() {
    const parts = [SYSTEM];
    if (booted?.profile?.length) {
      parts.push("Memories already recalled about this user:\n" + booted.profile.map((m) => "- " + m.text).join("\n"));
    }
    if (booted?.trail?.length) {
      parts.push("Recent conversation trail:\n" + booted.trail.map((m) => "- " + m.text).join("\n"));
    }
    return parts.join("\n\n");
  }

  async function chat(text) {
    if (!booted) await boot(text);
    history.push({ role: "user", content: text });
    for (let step = 0; step < 4; step += 1) {
      const out = await llm.complete([{ role: "system", content: systemPrompt() }, ...history], { tools: toolSpecs });
      if (out.toolCalls.length) {
        history.push({ role: "assistant", content: out.content, tool_calls: out.toolCalls });
        for (const call of out.toolCalls) {
          const args = JSON.parse(call.function.arguments || "{}");
          onEvent({ type: "tool", name: call.function.name, args });
          let result;
          try {
            result = await runTool(mem, call.function.name, args, ns);
          } catch (err) {
            result = { error: String(err.message) };
          }
          history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue;
      }
      history.push({ role: "assistant", content: out.content });
      return out.content;
    }
    return history[history.length - 1]?.content || "";
  }

  // After an exchange, ask the model what is worth keeping forever. This is the part that
  // turns a stateless chat into something that remembers across sessions.
  async function capture() {
    const recent = history.slice(-6).map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : ""}`).join("\n");
    const ask = `From the exchange below, extract facts about the USER that will still be true and useful in a month.
Return JSON: {"facts":[{"text":"...","namespace":"profile"|"notes"}]}. Use "profile" for identity, preferences and habits; "notes" for projects, decisions and plans. Return {"facts":[]} if nothing qualifies.

Exchange:
${recent}`;
    let parsed;
    try {
      const out = await llm.complete([{ role: "user", content: ask }], { json: true, maxTokens: 500 });
      parsed = JSON.parse(out.content || "{}");
    } catch {
      return { saved: [] };
    }
    const items = (parsed.facts || []).filter((f) => f?.text).slice(0, Number(process.env.MAX_WRITES_PER_TURN || 4)).map((f) => ({
      text: f.text,
      namespace: f.namespace === "profile" ? ns.profile : ns.notes,
    }));
    if (!items.length) return { saved: [] };
    const r = await rememberMany(mem, items).catch((e) => ({ error: e.message, results: [] }));
    const saved = (r.results || []).filter((x) => x.blob_id).map((x) => ({ blob_id: x.blob_id, namespace: x.namespace }));
    return { saved, error: r.error };
  }

  return { chat, boot, capture, history, ns, getBooted: () => booted };
}
