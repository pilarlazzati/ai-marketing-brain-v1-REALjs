const app = express();
const diag = { gen: 0, genFail: 0, polish: 0, polishFail: 0 };

// Middleware
app.use(express.json());
app.use(express.static('public'));

// KB_CHUNKS definition
let KB_CHUNKS = [];
try {
  KB_CHUNKS = require('./datadata/kb.mdkb.md') || [];
} catch {
  KB_CHUNKS = [];
}

// Deep health endpoint
app.get("/health/deep", async (req, res) => {
  const ping = String(req.query.ping || "") === "1";
  let openai_ok = false, openai_error = null;

  if (openai && ping) {
    try {
      await openai.chat.completions.create({
        model: process.env.OPENAI_JSON_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0
      });
      openai_ok = true;
    } catch (e) {
      openai_error = { status: e?.status || e?.response?.status, message: e?.message };
    }
  }

  res.json({
    ok: true,
    mock: USE_MOCK,
    model: process.env.OPENAI_JSON_MODEL || "gpt-4o-mini",
    kb_chunks: Array.isArray(KB_CHUNKS) ? KB_CHUNKS.length : 0,
    openai_present: !!openai,
    openai_ok,
    openai_error
  });
});