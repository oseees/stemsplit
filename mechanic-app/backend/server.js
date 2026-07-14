import "dotenv/config";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(express.json());

// Reads ANTHROPIC_API_KEY from the environment (.env).
const client = new Anthropic();

const SYSTEM_PROMPT = `You are an expert automotive mechanic assistant.

Given a car (year/make/model) and a repair task, produce a concise, practical
job sheet for a DIY mechanic.

- "tools": the specific tools required (e.g. "10mm socket", "torque wrench").
- "parts": the replacement parts and consumables needed. For each part give:
    - "name": the part with any useful spec (e.g. "Front brake pads (ceramic)").
    - "image_query": a SHORT, GENERIC term that would find a clear stock photo
      in an encyclopedia — e.g. "car brake pad", "engine air filter", "spark plug".
      Add "car"/"automotive" when a term is ambiguous across industries.
      Do NOT include the year/brand, part numbers, or words like "set"/"kit".
- "steps": ordered instructions. For each step give:
    - "instruction": the action to perform, including safety precautions.
    - "visual": one short sentence describing what the mechanic is looking at or
      what it should look like — e.g. "The caliper is the metal clamp straddling
      the rotor, held by two bolts on the back side."

Be specific to the given vehicle where it matters. Keep each entry short.
Respond ONLY with the structured JSON object — no prose, no markdown.`;

// Forces the response into exactly { tools, parts:[{name,image_query}], steps:[{instruction,visual}] }.
const REPAIR_SCHEMA = {
  type: "object",
  properties: {
    tools: { type: "array", items: { type: "string" } },
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          image_query: { type: "string" },
        },
        required: ["name", "image_query"],
        additionalProperties: false,
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          instruction: { type: "string" },
          visual: { type: "string" },
        },
        required: ["instruction", "visual"],
        additionalProperties: false,
      },
    },
  },
  required: ["tools", "parts", "steps"],
  additionalProperties: false,
};

// Part photos: free Openverse image search picks candidates, then Claude vision
// selects the one that actually depicts the part. No image API key needed.
const UA = "MechanicAppMVP/1.0 (mechanic-app demo)";
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// Stage 1: pull candidate photos from Openverse (free CC image search, no key).
async function fetchCandidates(query, n = 6) {
  if (!query) return [];
  const url =
    `https://api.openverse.org/v1/images/?page_size=${n}&mature=false` +
    `&q=${encodeURIComponent(query)}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const data = await r.json();
    return (data?.results ?? []).map((x) => ({
      thumbnail: x.thumbnail,
      url: x.url,
      title: x.title,
    }));
  } catch {
    return [];
  }
}

// Download an image as base64 (more reliable for the vision call than handing
// the API a redirecting thumbnail URL). Returns null on failure / non-images.
async function toBase64Image(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const mediaType = (r.headers.get("content-type") || "")
      .split(";")[0]
      .trim();
    if (!IMG_TYPES.has(mediaType)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3_500_000) return null;
    return { media_type: mediaType, data: buf.toString("base64") };
  } catch {
    return null;
  }
}

// Stage 2: show Claude the candidate photos and let it pick the one that truly
// depicts the part (or none) — keyword search matches words, not pixels.
async function pickBestImageUrl(partName, candidates) {
  const prepared = (
    await Promise.all(
      candidates.slice(0, 8).map(async (c) => {
        const img = await toBase64Image(c.thumbnail || c.url);
        return img ? { img, source: c } : null;
      }),
    )
  ).filter(Boolean);
  if (prepared.length === 0) return null;

  const content = [
    {
      type: "text",
      text:
        `These are candidate photos for the auto part: "${partName}". ` +
        `Pick the ONE image that most clearly shows that exact part as the main ` +
        `subject. Images are numbered starting at 1.`,
    },
  ];
  prepared.forEach((p, i) => {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: p.img.media_type, data: p.img.data },
    });
  });

  try {
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 100,
      system:
        "You match product photos to a named auto part. Return the 1-based index " +
        "of the single best image, or 0 if none clearly depict the part.",
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { best: { type: "integer" } },
            required: ["best"],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: "user", content }],
    });
    const text = resp.content.find((b) => b.type === "text")?.text ?? "{}";
    const best = JSON.parse(text).best;
    if (!Number.isInteger(best) || best < 1 || best > prepared.length) return null;
    const chosen = prepared[best - 1].source;
    return chosen.thumbnail || chosen.url || null;
  } catch (err) {
    console.error("[vision pick] error:", err?.message);
    return null;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.post("/api/repair", async (req, res) => {
  const { car, task } = req.body ?? {};
  if (!car || !task) {
    return res.status(400).json({ error: "Both 'car' and 'task' are required." });
  }

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: REPAIR_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Car: ${car}\nRepair task: ${task}`,
        },
      ],
    });

    // output_config.format guarantees the first text block is valid schema JSON.
    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const plan = JSON.parse(text);

    // Attach a vision-verified photo URL to each part (all parts in parallel).
    const parts = await Promise.all(
      (plan.parts ?? []).map(async (p) => {
        // Pool candidates from the generic query AND the part name for recall.
        const cleanName = p.name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
        const queries = [...new Set([p.image_query, cleanName].filter(Boolean))];
        const lists = await Promise.all(queries.map((q) => fetchCandidates(q, 8)));
        const seen = new Set();
        const candidates = lists.flat().filter((c) => {
          const k = c.thumbnail || c.url;
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        const imageUrl = await pickBestImageUrl(p.name, candidates);
        return { ...p, imageUrl };
      }),
    );

    res.json({ tools: plan.tools ?? [], parts, steps: plan.steps ?? [] });
  } catch (err) {
    console.error("[/api/repair] error:", err);
    const status = err?.status ?? 500;
    res.status(status).json({ error: err?.message ?? "Unknown error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔧 Mechanic backend listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY is not set — add it to backend/.env before calling /api/repair.");
  }
});
