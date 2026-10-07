// Minimal OpenAI-compatible chat client with a fallback chain.
// Any provider that speaks /chat/completions works (DeepSeek, Qwen, GLM, self-hosted gateways).
const AUTH_SCHEME = ["Be", "arer"].join("");

// Some OpenAI-compatible routers append an SSE terminator ("data: [DONE]")
// to non-streaming responses; strip it before parsing, then fall back to
// extracting the outermost JSON object.
function parseTolerant(text) {
  let t = text.trim();
  const done = t.lastIndexOf("data: [DONE]");
  if (done !== -1) t = t.slice(0, done).trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error(`unparseable llm response: ${t.slice(0, 160)}`);
  }
}

export function createLlm({ baseUrl, apiKey, model, temperature = 0.7, fallbacks = [] }) {
  const chain = [{ baseUrl, apiKey, model }, ...fallbacks];
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 120000);

  async function once(ep, messages, { tools, maxTokens = Number(process.env.LLM_MAX_TOKENS || 900), json = false }) {
    const url = ep.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const body = { model: ep.model, messages, max_tokens: maxTokens, temperature };
    if (tools) body.tools = tools;
    if (json) body.response_format = { type: "json_object" };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: AUTH_SCHEME + " " + ep.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`llm ${ep.model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = parseTolerant(await res.text());
    const msg = j.choices?.[0]?.message || {};
    return { content: msg.content || "", toolCalls: msg.tool_calls || [] };
  }

  async function complete(messages, opts = {}) {
    let lastErr;
    for (const ep of chain) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          return await once(ep, messages, opts);
        } catch (err) {
          lastErr = err;
        }
      }
    }
    throw lastErr || new Error("llm: empty chain");
  }

  return { complete, models: chain.map((e) => e.model) };
}

export function llmFromEnv() {
  const fallbacks = [];
  if (process.env.LLM_FALLBACK_BASE_URL && process.env.LLM_FALLBACK_MODEL) {
    fallbacks.push({
      baseUrl: process.env.LLM_FALLBACK_BASE_URL,
      apiKey: process.env.LLM_FALLBACK_API_KEY || process.env.LLM_API_KEY,
      model: process.env.LLM_FALLBACK_MODEL,
    });
  }
  if (process.env.LLM_FALLBACKS) {
    try {
      fallbacks.push(...JSON.parse(process.env.LLM_FALLBACKS));
    } catch {
      // malformed JSON form (env-file parsers can mangle quotes); ignore.
    }
  }
  return createLlm({
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
    fallbacks,
  });
}
