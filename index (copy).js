// ======================= index.js (FULL FILE) =======================
try {
  require("dotenv").config();
} catch (_) {}

const express = require("express");
const path = require("path");
const { z } = require("zod");
const { nanoid } = require("nanoid");
const { createObjectCsvWriter } = require("csv-writer");
const fsp = require("fs/promises");

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
  "Watch Time": ["youtube", "instagram", "linkedin"],
  Leads: ["linkedin", "instagram", "youtube"],
};

// ---------- Helpers ----------
const clamp = (s, n) => {
  const t = String(s || "");
  return n && t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const stripEmojis = (s) =>
  String(s || "").replace(
    /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu,
    "",
  );

// Deterministic (mock/fallback) generators
function genInstagram({ product, headline, body, cta, audience, proof }) {
  const hook = clamp(
    headline || `${product}: built for ${audience || "you"}`,
    90,
  );
  const main = clamp(
    body ||
      `Turn one winning creative into platform-ready variants in minutes.`,
    180,
  );
  const closing = clamp(cta || "Learn more", 40);
  const hashBase = (product.split(/\s+/)[0] || "brand").toLowerCase();
  const hashtags = `#${hashBase} #${(audience || "marketing").toLowerCase().replace(/\s+/g, "")} #ad`;
  return `${hook}\n\n${main}\n\n${proof ? `Proof: ${proof}\n\n` : ""}${closing} ›\n${hashtags}`;
}
function genYouTube({ product, headline, body, cta, audience, proof }) {
  return [
    `HOOK (0–2s): ${headline || `See ${product} fix ${audience || "your"} pain.`}`,
    `SCENE 1 (2–10s): Pain for ${audience || "teams"} in 1 sentence.`,
    `SCENE 2 (10–25s): ${product} solves it. ${proof ? `(${proof})` : ""}`,
    `SCENE 3 (25–45s): 2–3 benefits on screen.`,
    `SCENE 4 (45–55s): Quick demo or before/after.`,
    `CTA (55–60s): ${cta || "Tap to try it today."}`,
  ].join("\n");
}
function genLinkedIn({ product, headline, body, cta, audience, proof }) {
  const p1 =
    headline ||
    `A faster way for ${audience || "teams"} to win with ${product}`;
  const p2 =
    body ||
    `${product} turns one winning creative into platform-ready variants in minutes, not weeks.`;
  const p3 = proof
    ? `Proof: ${proof}`
    : `Early teams report faster testing cycles and clearer creative insights.`;
  const p4 = `If you want a practical way to scale what already works, this is it.`;
  const p5 =
    cta || `DM me for the demo link or comment "DEMO" and I’ll share it.`;
  return [p1, "", p2, "", p3, "", p4, "", p5].join("\n");
}
function makeVariant(channelKey, inputs, goal) {
  const base = CHANNEL_SPECS[channelKey];
  let copy =
    channelKey === "instagram"
      ? genInstagram(inputs)
      : channelKey === "youtube"
        ? genYouTube(inputs)
        : genLinkedIn(inputs);
  copy = stripEmojis(copy);
  copy = clamp(copy, base.maxChars);

  const rationaleGoal =
    goal === "Watch Time"
      ? "Hook early; tight beats sustain viewing."
      : goal === "Leads"
        ? "Outcome-focused copy + clear CTA to drive form fills."
        : "Punchy hook + skimmable benefits to raise CTR.";
  return {
    channel: base.label,
    copy,
    specs: base.specs,
    rationale: `Tailored to ${base.label}. ${rationaleGoal}`,
  };
}
function makeABPlan(inputs, goal) {
  const metric =
    goal === "Watch Time"
      ? "3s views & avg % viewed"
      : goal === "Leads"
        ? "Form submit rate / demo requests"
        : "Click-through rate";
  return {
    hypothesis: `A stronger hook referencing “${inputs.audience || "your audience"}” increases ${metric} by 15–25%.`,
    variantA: "Conservative: keep original hook and straightforward CTA.",
    variantB: "Bold: punchy hook + time-bound CTA in the first line.",
    metric,
    run: "3–7 days with even spend; declare winner at practical uplift.",
  };
}

// ---------- REAL LLM generator (ONE copy; robust parsing) ----------
async function genVariantsLLM({ text, goal }) {
  if (!openai) throw new Error("OpenAI not configured");

  const rules = Object.values(CHANNEL_SPECS)
    .map((v) => `${v.label}: ${v.specs.join("; ")} (max ${v.maxChars} chars)`)
    .join("\n- ");

  const sys = [
    "You are a marketing copy assistant.",
    "Return STRICT JSON in this exact shape:",
    '{"variants":[{"platform":"","copy":"","spec":{},"rationale":""}]}',
    "No markdown, no code fences, no extra text.",
  ].join("\n");

  const user = {
    goal,
    text,
    platform_rules: rules,
    platforms: Object.values(CHANNEL_SPECS).map((v) => v.label),
  };

  const model = process.env.OPENAI_JSON_MODEL || "gpt-4o-mini";

  // Simpler call (skip response_format to avoid 400s on some accounts)
  const resp = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: JSON.stringify(user) },
    ],
    max_tokens: 600,
  });

  const raw = String(resp.choices?.[0]?.message?.content || "").trim();

  function safeParseJson(s) {
    try {
      return JSON.parse(s);
    } catch {}
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {}
    }
    return null;
  }

  const parsed = safeParseJson(raw);
  if (!parsed || !Array.isArray(parsed.variants)) {
    console.error("[genVariantsLLM] bad JSON from model:", raw.slice(0, 300));
    // minimal fallback so pipeline continues
    return Object.values(CHANNEL_SPECS)
      .slice(0, 3)
      .map((v) => ({
        platform: v.label,
        copy: `${text} — optimized for ${v.label}`,
        spec: v.specs,
        rationale: `Matches ${v.label} norms.`,
      }));
  }

  return parsed.variants.slice(0, 3).map((v) => {
    const spec = Object.values(CHANNEL_SPECS).find(
      (s) => s.label === v.platform,
    );
    const max = spec?.maxChars ?? 900;
    return {
      platform: v.platform || spec?.label || "Unknown",
      copy: clamp(stripEmojis(String(v.copy || "")), max),
      spec: v.spec || (spec ? spec.specs : []),
      rationale: String(v.rationale || "").slice(0, 240),
    };
  });
}

// ---------- Keep your existing UI endpoints working ----------
const InputSchema = z.object({
  product: z.string().min(1, "product required"),
  headline: z.string().optional().default(""),
  body: z.string().optional().default(""),
  cta: z.string().optional().default(""),
  audience: z.string().optional().default(""),
  proof: z.string().optional().default(""),
  channels: z
    .array(z.enum(["instagram", "youtube", "linkedin"]))
    .min(1, "pick at least one channel")
    .optional(),
  goal: z.enum(["CTR", "Watch Time", "Leads"]).optional().default("CTR"),
});

function generateHandler(req, res) {
  try {
    const parsed = InputSchema.safeParse(req.body || {});
    if (!parsed.success) {
      diag.genFail++;
      return res
        .status(400)
        .json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    }
    const { channels, goal, ...inputs } = parsed.data;
    const finalChannels =
      channels && channels.length ? channels : GoalToChannels[goal];
    const variants = finalChannels.map((c) => makeVariant(c, inputs, goal));
    const abplan = makeABPlan(inputs, goal);
    diag.gen++;
    return res.json({
      variants,
      abplan,
      aiAvailable: !!openai,
      version: VERSION,
    });
  } catch (e) {
    console.error(e);
    diag.genFail++;
    return res.status(500).json({ error: "Generation failed." });
  }
}
app.post("/generate", generateHandler);
app.post("/api/generate", generateHandler);

app.post("/polish", async (req, res) => {
  try {
    if (!openai) {
      return res.json({
        polished: null,
        message: "AI key not configured; using rule engine only.",
      });
    }
    const Body = z.object({
      context: z.object({
        product: z.string(),
        audience: z.string().optional().default(""),
        goal: z.enum(["CTR", "Watch Time", "Leads"]).optional().default("CTR"),
        polishOnlyOne: z.boolean().optional().default(false),
      }),
      variants: z.array(
        z.object({
          channel: z.string(),
          copy: z.string(),
          specs: z.array(z.string()),
        }),
      ),
    });
    const parsed = Body.safeParse(req.body || {});
    if (!parsed.success) {
      diag.polishFail++;
      return res.status(400).json({ error: "Bad polish payload." });
    }

    const { context, variants } = parsed.data;
    const toPolish = context.polishOnlyOne ? [variants[0]] : variants;

    const out = [];
    for (const v of toPolish) {
      const max =
        Object.values(CHANNEL_SPECS).find((s) => s.label === v.channel)
          ?.maxChars ?? 900;
      const prompt = [
        `Improve the copy for ${v.channel}.`,
        `Constraints: keep under ${max} characters. Preserve meaning. Punchy. Respect norms: ${v.specs.join("; ")}`,
        `Context: product=${context.product}, audience=${context.audience}, goal=${context.goal}.`,
        `Original:\n${v.copy}\n\nReturn ONLY the improved copy text.`,
      ].join("\n");

      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_JSON_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 240,
        messages: [{ role: "user", content: prompt }],
      });

      const improved = clamp(
        String(completion.choices?.[0]?.message?.content || "").trim(),
        max,
      );
      out.push({ ...v, copy: improved });
    }
    const merged = context.polishOnlyOne ? [out[0], ...variants.slice(1)] : out;
    diag.polish++;
    return res.json({ polished: merged });
  } catch (err) {
    console.error(err);
    diag.polishFail++;
    return res.status(500).json({ error: "Polish failed." });
  }
});

// ---------- MVP loop: REAL (+ fallback), CSV, share page ----------
const memory = new Map();

app.post("/variants", async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || "").trim();
    const goal = (req.body && req.body.goal) || "CTR";
    if (!text) return res.status(400).json({ error: "Provide 'text' in body" });

    let variants;
    if (!USE_MOCK && openai) {
      variants = await genVariantsLLM({ text, goal }); // REAL
    } else {
      // Fallback to deterministic (MOCK)
      const inputs = {
        product: "Your Product",
        headline: text,
        body: "",
        cta: "Learn more",
        audience: "",
        proof: "",
      };
      const channels = ["instagram", "youtube", "linkedin"];
      const v3 = channels.map((c) => makeVariant(c, inputs, goal));
      variants = v3.map((v) => ({
        platform: v.channel,
        copy: v.copy,
        spec: v.specs,
        rationale: v.rationale,
      }));
    }

    // Write CSV
    const request_id = nanoid();
    const csvPath = path.join(EXPORT_DIR, `${request_id}.csv`);
    const writer = createObjectCsvWriter({
      path: csvPath,
      header: [
        { id: "platform", title: "Platform" },
        { id: "copy", title: "Copy" },
        { id: "spec", title: "Spec(JSON)" },
        { id: "rationale", title: "Rationale" },
      ],
    });
    await writer.writeRecords(
      variants.map((r) => ({ ...r, spec: JSON.stringify(r.spec) })),
    );

    const csv_url = `/exports/${request_id}.csv`;
    const share_url = `/v/${request_id}`;

    memory.set(request_id, { request_id, variants, csv_url, share_url });

    return res.json({
      request_id,
      variants,
      csv_url,
      share_url,
      version: VERSION,
      mock: USE_MOCK,
    });
  } catch (e) {
    const status = e?.status || e?.response?.status;
    const data = e?.response?.data;
    console.error("[/variants] ERROR", {
      message: e?.message,
      status,
      data,
      name: e?.name,
      stack: e?.stack,
    });
    return res.status(500).json({ error: "Internal error" });
  }
});

app.get("/api/variants/:id", (req, res) => {
  const data = memory.get(req.params.id);
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

app.get("/v/:id", (req, res) => {
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Variants</title>
<style>body{font-family:system-ui;margin:24px} pre{white-space:pre-wrap}</style>
</head>
<body>
  <h1>Variants for <span id="rid"></span></h1>
  <div id="list"></div>
  <script>
    (async () => {
      const rid = location.pathname.split('/').pop();
      document.getElementById('rid').textContent = rid;
      const r = await fetch('/api/variants/' + rid);
      const data = await r.json();
      const list = document.getElementById('list');
      (data.variants || []).forEach(v => {
        const el = document.createElement('div');
        el.innerHTML = '<h3>'+v.platform+'</h3><p>'+v.copy+'</p><pre>'+JSON.stringify(v.spec,null,2)+'</pre><em>'+v.rationale+'</em><hr/>';
        list.appendChild(el);
      });
    })();
  </script>
</body></html>`);
});

// ---- Health / Diag ----
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    mock: USE_MOCK,
    model: process.env.OPENAI_JSON_MODEL || "gpt-4o-mini",
  });
});
app.get("/diag", (_req, res) => res.json(diag));

// ---- Start ----
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
// ===================== end index.js (FULL) =====================
