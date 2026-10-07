// Tools the model can call. Namespaces are fixed on purpose: a chatbot that writes
// anywhere it likes becomes an unauditable memory dump.
import { NS, recall, remember } from "./memory.mjs";

export const TOOL_SPECS = [
  {
    type: "function",
    function: {
      name: "recall_memory",
      description:
        "Search this user's long-term memory on Walrus. Use it before answering anything that could depend on earlier conversations (name, preferences, ongoing projects, past decisions).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to look for, in natural language." },
          namespace: { type: "string", enum: [NS.profile, NS.notes, NS.log], description: "Which memory space to search." },
          limit: { type: "integer", description: "Max results (default 5)." },
        },
        required: ["query", "namespace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Persist one durable fact about this user to Walrus. One fact per call, written as a standalone sentence that will still make sense months later. Do not save small talk, questions, or anything the user did not actually state.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The fact, as a standalone sentence." },
          namespace: { type: "string", enum: [NS.profile, NS.notes], description: "profile = identity/preferences, notes = everything else." },
        },
        required: ["text", "namespace"],
      },
    },
  },
];

export async function runTool(mem, name, args) {
  if (name === "recall_memory") {
    const hits = await recall(mem, args.query, args.namespace, args.limit || 5);
    return { hits, count: hits.length };
  }
  if (name === "save_memory") {
    const r = await remember(mem, args.text, args.namespace || NS.notes);
    return { saved: true, blob_id: r.blob_id };
  }
  throw new Error(`unknown tool: ${name}`);
}
