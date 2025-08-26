// ======================= index.js (FULL FILE) =======================
try { require("dotenv").config(); } catch (_) {}

const express = require("express");
const path = require("path");
const { z } = require("zod");
const { nanoid } = require("nanoid");
const { createObjectCsvWriter } = require("csv-writer");
const fsp = require("fs/promises");

// ---- KB helpers ----
const loadKB = async () => {
  try {
    const kbPath = path.join(__dirname, "kb.mdkb.md");
    const content = await fsp.readFile(kbPath, "utf-8");
    return content;
  } catch (err) {
    console.log("[KB] No knowledge base found:", err.message);
    return "";
  }
};

const pickKBContext = (query, kb) => {
  if (!kb || !query) return "";
  const lines = kb.split("\n").filter(l => l.trim());
  const relevant = lines.filter(line => {
    const lowerLine = line.toLowerCase();
    const lowerQuery = query.toLowerCase();
    return lowerQuery.split(" ").some(word => lowerLine.includes(word));
  }).slice(0, 10);
  return relevant.length ? relevant.join("\n") : kb.slice(0, 800);
};

const safeJsonParse = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

const initKB = async () => {
  const kb = await loadKB();
  console.log("[KB] Loaded", kb ? kb.length : 0, "chars");
  return kb;
};

// Initialize KB at startup
let GLOBAL_KB = "";
initKB().then(kb => { GLOBAL_KB = kb; });

// ---- Config / Flags ----
const USE_MOCK = String(process.env.USE_MOCK || "true") === "true";
const PORT = Number(process.env.PORT || 3000);
const VERSION = `v1.2.${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

// ---- OpenAI (optional; safe if missing) ----
let openai = null;
try {
  const OpenAI = require("openai");
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (_) {}
console.log("OpenAI configured:", !!openai, "USE_MOCK:", USE_MOCK);

// ---- App ----
const app = express();
const diag = { gen: 0, genFail: 0, polish: 0, polishFail: 0 };

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// static
app.use(express.static(path.join(__dirname, "public")));
app.use("/exports", express.static(path.join(__dirname, "public", "exports")));
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));

// ensure export dir
const EXPORT_DIR = path.join(__dirname, "public", "exports");
fsp.mkdir(EXPORT_DIR, { recursive: true }).catch(() => {});

// ---------- Channel rules ----------
const CHANNEL_SPECS = {
  instagram: {
    label: "Instagram Feed",
    specs: [
      "Image 1080×1350 (4:5)",
      "Primary text ≤125 chars ideal",
      "1 CTA; 5–10 hashtags optional",
    ],
    maxChars: 300,
  },
  youtube: {
    label: "YouTube Shorts",
    specs: ["≤60s; vertical; hook in first 2s", "5-beat outline"],
    maxChars: 800,
  },
  linkedin: {
    label: "LinkedIn",
    specs: ["700–900 chars", "3–5 short paragraphs", "≤3 hashtags or none"],
    maxChars: 900,
  },
};

const GoalToChannels = {
  CTR: ["instagram", "linkedin", "youtube"],
  Engagement: ["instagram", "linkedin", "youtube"],
  Conversion: ["linkedin", "instagram", "youtube"],
};

// ---------- LLM / Generation ----------

/**
 * Generate variants with KB grounding
 */
async function genVariantsLLM(channels, originalContent, goalHint = "CTR", brandVoice = "") {
  const kbContext = pickKBContext(originalContent, GLOBAL_KB);

  const mockResponse = {
    instagram: {
      content: "🚀 Turn your top creative into 3 platform-ready variants in MINUTES! DTC CMOs - stop spending hours on repurposing. Our AI brain cuts time-to-publish by 80%. Ready to ship faster? Try the demo now! #DTCMarketing #ContentRepurposing #MarketingAutomation",
      reasoning: "Instagram post optimized for 4:5 image format with hook, value prop, and relevant hashtags. Kept under 300 chars for better engagement."
    },
    youtube: {
      content: "5-Beat Outline:\n1. HOOK: 'DTC CMOs - tired of content bottlenecks?'\n2. PROBLEM: 'Hours spent repurposing for each platform'\n3. SOLUTION: 'Omnify Marketing Brain - 3 variants in minutes'\n4. PROOF: 'Cut time-to-publish by 80%'\n5. CTA: 'Try the demo - link in bio'\n\nVertical format, grab attention in first 2 seconds with the CMO pain point.",
      reasoning: "YouTube Shorts format with 5-beat structure, vertical orientation focus, and strong hook addressing target audience pain."
    },
    linkedin: {
      content: "DTC CMOs at $50-150M brands know this pain:\n\nYou've got winning creative, but adapting it for each platform eats up precious hours.\n\nWhat if you could take your top-performing content and instantly generate channel-ready versions?\n\nThat's exactly what Omnify Marketing Brain delivers. Ship 3 platform variants in minutes, not hours.\n\nThe result? 80% faster time-to-publish.\n\nReady to transform your content workflow?",
      reasoning: "LinkedIn format with 3 short paragraphs, professional tone for CMO audience, no hashtags for cleaner look, around 700 chars."
    }
  };

  if (USE_MOCK || !openai) {
    console.log("[genVariantsLLM] Using mock (USE_MOCK=", USE_MOCK, ", openai=", !!openai, ")");
    diag.gen++;
    return mockResponse;
  }

  try {
    const prompt = `You are an expert content creator. Generate ${channels.length} platform variants optimized for ${goalHint}.

KNOWLEDGE BASE CONTEXT:
${kbContext}

ORIGINAL CONTENT:
${originalContent}

BRAND VOICE: ${brandVoice}

CHANNEL SPECS:
${channels.map(ch => `${ch}: ${JSON.stringify(CHANNEL_SPECS[ch])}`).join("\n")}

Return JSON with this structure:
{
  "channelName": {
    "content": "adapted content",
    "reasoning": "brief explanation"
  }
}

Requirements:
- Follow each channel's character limits and format specs exactly
- Use knowledge base context to ensure brand consistency
- Optimize for the specified goal (${goalHint})
- Include reasoning for each adaptation`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_JSON_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const result = safeJsonParse(response.choices[0]?.message?.content || "{}");
    if (!result) throw new Error("Failed to parse JSON response");

    diag.gen++;
    return result;
  } catch (err) {
    console.error("[genVariantsLLM] Error:", err.message);
    diag.genFail++;
    return mockResponse;
  }
}

// ---------- Polish function ----------
async function polishVariants(variants, feedback) {
  if (USE_MOCK || !openai) {
    console.log("[polishVariants] Using mock");
    diag.polish++;
    return variants; // Return as-is for mock
  }

  try {
    const prompt = `Polish these content variants based on feedback.

CURRENT VARIANTS:
${JSON.stringify(variants, null, 2)}

FEEDBACK:
${feedback}

Return improved JSON in same structure. Keep channel specs and limits.`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_JSON_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.5,
    });

    const result = safeJsonParse(response.choices[0]?.message?.content || "{}");
    diag.polish++;
    return result || variants;
  } catch (err) {
    console.error("[polishVariants] Error:", err.message);
    diag.polishFail++;
    return variants;
  }
}

// ---------- API Routes ----------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: VERSION, ...diag });
});

app.get("/api/channels", (req, res) => {
  res.json({ channels: CHANNEL_SPECS, goals: GoalToChannels });
});

app.post("/api/generate-variants", async (req, res) => {
  try {
    const { originalContent, goal = "CTR", brandVoice = "", channels } = req.body;

    if (!originalContent) {
      return res.status(400).json({ error: "originalContent required" });
    }

    const targetChannels = channels || GoalToChannels[goal] || ["instagram", "linkedin", "youtube"];
    const variants = await genVariantsLLM(targetChannels, originalContent, goal, brandVoice);

    res.json({ variants, goal, channels: targetChannels });
  } catch (error) {
    console.error("Generate variants error:", error);
    res.status(500).json({ error: "Generation failed" });
  }
});

app.post("/api/polish-variants", async (req, res) => {
  try {
    const { variants, feedback } = req.body;

    if (!variants || !feedback) {
      return res.status(400).json({ error: "variants and feedback required" });
    }

    const polished = await polishVariants(variants, feedback);
    res.json({ variants: polished });
  } catch (error) {
    console.error("Polish variants error:", error);
    res.status(500).json({ error: "Polish failed" });
  }
});

// Export route
app.post("/api/export", async (req, res) => {
  try {
    const { variants, originalContent, goal } = req.body;

    if (!variants) {
      return res.status(400).json({ error: "variants required" });
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const exportId = nanoid();
    const filename = `export-${exportId}.csv`;
    const filepath = path.join(EXPORT_DIR, filename);

    // Prepare CSV data
    const csvData = Object.entries(variants).map(([channel, data]) => ({
      channel,
      content: typeof data === 'object' ? data.content : data,
      reasoning: typeof data === 'object' ? data.reasoning : '',
      goal: goal || 'CTR',
      timestamp,
      original: originalContent || ''
    }));

    const csvWriter = createObjectCsvWriter({
      path: filepath,
      header: [
        { id: 'channel', title: 'Channel' },
        { id: 'content', title: 'Content' },
        { id: 'reasoning', title: 'Reasoning' },
        { id: 'goal', title: 'Goal' },
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'original', title: 'Original Content' }
      ]
    });

    await csvWriter.writeRecords(csvData);

    const downloadUrl = `/exports/${filename}`;
    res.json({ 
      success: true, 
      downloadUrl, 
      filename,
      exportId 
    });
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ error: "Export failed" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Version: ${VERSION}`);
});