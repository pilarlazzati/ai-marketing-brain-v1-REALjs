const express = require("express");
const fs = require("fs");
const path = require("path");

// Load KB (JSON, demo style)
const kb = JSON.parse(fs.readFileSync("./omnify_kb.json", "utf8"));

// Load USE_MOCK flag from env/Secrets
const USE_MOCK = process.env.USE_MOCK === "true";

// Initialize OpenAI
const { OpenAI } = require("openai");
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : undefined;

const app = express();
const diag = { gen: 0, genFail: 0, polish: 0, polishFail: 0 };

// Middleware
app.use(express.json());
app.use(express.static("public"));

// Load and log old KB chunks for compatibility/debug (optional)
let KB_CHUNKS = [];
const KB_PATH = path.join(__dirname, "data", "kb.md");
try {
  const raw = fs.readFileSync(KB_PATH, "utf8");
  KB_CHUNKS = raw
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
  console.log(`[KB] loaded ${KB_CHUNKS.length} chunks from ${KB_PATH}`);
} catch (e) {
  console.warn("[KB] not loaded:", e.message);
  KB_CHUNKS = [];
}

// MAIN GEN FUNCTION FOR LLM
async function genVariantsLLM({ text, goal, kb }) {
  const sys =
    'You are Omnify’s Marketing Brain. Ground outputs in the provided KB tactics, benchmarks, and templates. Output STRICT JSON: {"variants":[{"platform":"","copy":"","spec":{},"rationale":""}]}';

  const user = {
    goal,
    text,
    tactics: kb.priority_tactics,
    templates: kb.channel_templates,
    benchmarks: kb.benchmarks,
    case_studies: kb.case_studies,
  };

  const resp = await openai.chat.completions.create({
    model: process.env.OPENAI_JSON_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: JSON.stringify(user) },
    ],
  });

  const parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
  return parsed.variants?.slice(0, 3) || [];
}

// POST /variants ENDPOINT
app.post("/variants", async (req, res) => {
  try {
    const { text, goal } = req.body;
    let variants;

    if (!USE_MOCK && openai) {
      variants = await genVariantsLLM({ text, goal, kb });
    } else {
      // fallback: deterministic dummy variants for demo safety
      variants = [
        {
          platform: "Instagram Reels",
          copy: "Fallback: IG Reel variant",
          spec: {},
          rationale: "MOCK mode",
        },
        {
          platform: "TikTok",
          copy: "Fallback: TikTok variant",
          spec: {},
          rationale: "MOCK mode",
        },
        {
          platform: "YouTube Shorts",
          copy: "Fallback: Shorts variant",
          spec: {},
          rationale: "MOCK mode",
        },
      ];
    }
    // Example payload; add your CSV/share logic as needed
    res.json({
      request_id: Math.random().toString(36).slice(2),
      variants,
      csv_url: null,
      share_url: null,
      version: "v1",
      mock: USE_MOCK || !openai,
    });
  } catch (e) {
    console.error("Error in /variants: ", e);
    res
      .status(500)
      .json({ error: "Internal server error", message: String(e) });
  }
});

// Add health endpoints etc. if needed

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Omnify Marketing Brain backend running on port ${PORT}`);
});
