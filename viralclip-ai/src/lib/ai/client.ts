import OpenAI from "openai";

// Single OpenAI-compatible client. Point AI_BASE_URL at any compatible API.
export const ai = new OpenAI({
  // Placeholder fallback keeps module import safe at build time.
  apiKey: process.env.AI_API_KEY || "placeholder",
  baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
});

export const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

// Some OpenAI-compatible providers (e.g. Anthropic's compat endpoint) reject
// response_format: { type: "json_object" }. Off by default so it works
// everywhere; set AI_JSON_MODE=true for OpenAI/Groq to enforce JSON natively.
const JSON_MODE = process.env.AI_JSON_MODE === "true";

// Helper: call the model and parse a JSON object response.
export async function chatJSON<T>(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const res = await ai.chat.completions.create({
    model: opts.model ?? AI_MODEL,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 2000,
    ...(JSON_MODE ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      {
        role: "system",
        content:
          opts.system +
          "\n\nRespond with ONLY a single valid JSON object. No markdown, no code fences, no commentary.",
      },
      { role: "user", content: opts.user },
    ],
  });

  const text = res.choices[0]?.message?.content ?? "{}";
  return parseJSONObject<T>(text);
}

// Tolerant JSON extraction: strips ```json fences and pulls the first {...}
// block, so it survives models that wrap their output in prose or markdown.
function parseJSONObject<T>(raw: string): T {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("AI response was not valid JSON");
  }
}

export async function chatText(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const res = await ai.chat.completions.create({
    model: AI_MODEL,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 1500,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}
