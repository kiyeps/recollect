// Telegram channel -- Bot API long polling, zero dependencies.
// One agent instance per chat; every durable byte still lives on Walrus.
import { loadCredentials, createMemory } from "./memory.mjs";
import { llmFromEnv } from "./llm.mjs";
import { createAgent } from "./agent.mjs";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required for the Telegram channel");
const ALLOWED = (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SHOW_EVENTS = process.env.TELEGRAM_SHOW_EVENTS !== "0";

const api = async (method, payload = {}) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${JSON.stringify(j).slice(0, 220)}`);
  return j.result;
};

const mem = createMemory(loadCredentials());
const mkLlm = () => llmFromEnv();

const chats = new Map(); // chatId -> { agent, booted, lock }

function getChat(chatId) {
  if (!chats.has(chatId)) {
    const agent = createAgent({ mem, llm: mkLlm() });
    chats.set(chatId, { agent, booted: false, lock: Promise.resolve() });
  }
  return chats.get(chatId);
}

function split(text, n = 3900) {
  const out = [];
  let rest = text;
  while (rest.length > n) {
    let cut = rest.lastIndexOf("\n", n);
    if (cut < n * 0.5) cut = n;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

const HELP = [
  "Recollect - a chatbot whose memory lives on Walrus, not on the machine answering you.",
  "",
  "Tell me something about yourself, then send /memory to see what got durably stored.",
  "Restarting the server erases nothing: what you said stays remembered.",
  "",
  "Commands: /memory (recalled memories), /trail (recent conversation trail), /help",
].join("\n");

async function handle(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  if (ALLOWED.length && !ALLOWED.includes(String(userId))) return;
  const text = (msg.text || "").trim();
  if (!text) return;

  let st;
  try {
    st = getChat(chatId);
  } catch (e) {
    console.error("chat init error:", String(e?.message || e));
    return;
  }
  st.lock = st.lock
    .then(async () => {
      const typing = setInterval(
        () => api("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}),
        4000
      );
      try {
        if (!st.booted) {
          await st.agent.boot(text.slice(0, 120)).catch(() => {});
          st.booted = true;
        }

        if (text === "/start" || text === "/help") {
          await api("sendMessage", { chat_id: chatId, text: HELP });
          return;
        }
        if (text === "/memory") {
          const b = st.agent.getBooted();
          const lines = [];
          if (b?.profile?.length) lines.push("What I remember about you:");
          for (const m of b?.profile || []) lines.push(`- ${m.text}`);
          if (b?.trail?.length) {
            lines.push("", "Conversation trail:");
            for (const m of b?.trail || []) lines.push(`- ${m.text}`);
          }
          await api("sendMessage", { chat_id: chatId, text: lines.join("\n") || "Nothing stored yet." });
          return;
        }
        if (text === "/trail") {
          const b = st.agent.getBooted();
          const lines = (b?.trail || []).map((m) => `- ${m.text}`);
          await api("sendMessage", { chat_id: chatId, text: lines.join("\n") || "No trail yet." });
          return;
        }

        const answer = await st.agent.chat(text);
        const cap = await st.agent.capture().catch((e) => ({ error: e.message }));
        let out = answer || "(empty)";
        if (SHOW_EVENTS && cap.saved?.length) {
          out += `\n\n[memory saved to Walrus: ${cap.saved.map((s) => s.blob_id.slice(0, 10)).join(", ")}]`;
        }
        for (const part of split(out)) {
          await api("sendMessage", { chat_id: chatId, text: part });
        }
        // refresh the boot snapshot so /memory shows the latest facts
        await st.agent.boot("user identity and latest facts").catch(() => {});
      } catch (e) {
        await api("sendMessage", {
          chat_id: chatId,
          text: `Error: ${String(e.message).slice(0, 300)}`,
        }).catch(() => {});
      } finally {
        clearInterval(typing);
      }
    })
    .catch(() => {});
}

console.log("Recollect Telegram channel up. Long-polling for updates...");
let offset = 0;
for (;;) {
  try {
    const updates = await api("getUpdates", { timeout: 50, offset, allowed_updates: ["message"] });
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.message) handle(u.message);
    }
  } catch (e) {
    console.error("poll error:", String(e.message).slice(0, 200));
    await new Promise((r) => setTimeout(r, 3000));
  }
}
