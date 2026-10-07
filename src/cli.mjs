// CLI channel -- the shortest path to a reachable chatbot.
import readline from "node:readline/promises";
import { loadCredentials, createMemory } from "./memory.mjs";
import { llmFromEnv } from "./llm.mjs";
import { createAgent } from "./agent.mjs";

const creds = loadCredentials();
const mem = createMemory(creds);
const llm = llmFromEnv();
const agent = createAgent({
  mem,
  llm,
  onEvent: (e) => console.log(`   [memory:${e.name}] ${JSON.stringify(e.args).slice(0, 140)}`),
});

await agent.boot();
const booted = agent.getBooted();
console.log(`Recollect -- memory on Walrus. Recalled ${booted.profile.length} profile fact(s), ${booted.trail.length} trail entry(ies).`);
console.log("Commands: /mem  show recalled memory   /quit  exit");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const line = (await rl.question("you> ")).trim();
  if (!line) continue;
  if (line === "/quit") break;
  if (line === "/mem") {
    console.log(JSON.stringify(agent.getBooted(), null, 1));
    continue;
  }
  const answer = await agent.chat(line);
  console.log("\nrecollect> " + answer + "\n");
  const cap = await agent.capture();
  if (cap.saved?.length) {
    console.log(`   [remembered ${cap.saved.length} blob(s): ${cap.saved.map((s) => s.blob_id.slice(0, 14)).join(", ")}]\n`);
  } else if (cap.error) {
    console.log(`   [remember failed: ${cap.error}]\n`);
  }
}
rl.close();
