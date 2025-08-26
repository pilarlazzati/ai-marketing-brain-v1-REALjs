// =========================
// AI Marketing Brain (MVP)
// Frontend logic for /public UI
// - Stateless: sends inputs to /generate, receives 3 variants + A/B plan
// - Optional AI polish via /polish (token-thrifty, timeout-protected)
// =========================

// ---------- Small helpers ----------
const $ = (s) => document.querySelector(s);
const bar = $("#bar");

function setProgress(pct) {
  bar.style.width = pct + "%";
}

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Token/time safe polish: race against a short timeout so demo never stalls
const polishWithTimeout = (payload, ms = 2500) =>
  Promise.race([
    postJSON("/polish", payload),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("polish timeout")), ms),
    ),
  ]);

// CSV utility (for judges to take it home)
function toCSV(rows) {
  const header = [
    "channel",
    "copy",
    "specs",
    "rationale",
    "ab_hypothesis",
    "primary_metric",
  ];
  const lines = [header.join(",")];
  rows.forEach((r) => {
    const safe = (v) =>
      `"${String(v).replaceAll('"', '""').replaceAll("\n", " ")}"`;
    lines.push(
      [
        safe(r.channel),
        safe(r.copy),
        safe((r.specs || []).join(" • ")),
        safe(r.rationale || ""),
        safe(r.ab_hypothesis || ""),
        safe(r.primary_metric || ""),
      ].join(","),
    );
  });
  return lines.join("\n");
}

// ---------- Theme toggle ----------
$("#themeToggle").addEventListener("change", (e) => {
  document.body.classList.toggle("dark", e.target.checked);
});

// ---------- Presets (3 verticals) ----------
const PRESETS = {
  saas: {
    product: "Omnify Marketing Brain",
    headline: "Ship 3 platform variants in minutes",
    body: "Take your top creative and turn it into channel‑ready versions instantly.",
    cta: "Try the demo",
    audience: "DTC CMOs at $50–150M brands",
    proof: "Cut time‑to‑publish by 80%",
  },
  skincare: {
    product: "GlowRush Vitamin C Serum",
    headline: "Brighter skin in days — not months",
    body: "One winner → ready for every platform. Consistent tone, faster tests, clearer wins.",
    cta: "Shop the duo",
    audience: "Skincare shoppers 25–40",
    proof: "92% saw visible glow in 2 weeks",
  },
  luxury: {
    product: "Aurelia Atelier Loafers",
    headline: "Crafted for quiet confidence",
    body: "Elevate wardrobe staples with hand‑finished leather and timeless lines.",
    cta: "Explore the collection",
    audience: "Affluent professionals who value understated luxury",
    proof: "Italian calfskin • limited run",
  },
};

function setInputs(p) {
  $("#product").value = p.product || "";
  $("#headline").value = p.headline || "";
  $("#body").value = p.body || "";
  $("#cta").value = p.cta || "";
  $("#audience").value = p.audience || "";
  $("#proof").value = p.proof || "";
}
setInputs(PRESETS["saas"]); // default landing preset

$("#preset").addEventListener("change", (e) => {
  const key = e.target.value;
  if (PRESETS[key]) setInputs(PRESETS[key]);
});

$("#demo").addEventListener("click", () => {
  setInputs(PRESETS["saas"]);
  document.querySelectorAll(".ch").forEach((c) => (c.checked = true));
  $("#goal").value = "CTR";
});

// Quick vertical buttons that prefills + auto-runs
document.querySelectorAll(".vbtn").forEach((b) => {
  b.addEventListener("click", () => {
    const key = b.dataset.preset;
    if (PRESETS[key]) {
      setInputs(PRESETS[key]);
      $("#goal").value = "CTR";
      document.querySelectorAll(".ch").forEach((c) => (c.checked = true));
      $("#generate").click();
    }
  });
});

// ---------- Generate flow ----------
$("#generate").addEventListener("click", async () => {
  const channels = [...document.querySelectorAll(".ch:checked")].map(
    (c) => c.value,
  );
  const payload = {
    product: $("#product").value.trim(),
    headline: $("#headline").value.trim(),
    body: $("#body").value.trim(),
    cta: $("#cta").value.trim(),
    audience: $("#audience").value.trim(),
    proof: $("#proof").value.trim(),
    channels,
    goal: $("#goal").value,
    useAIPolish: $("#useAIPolish").checked,
    polishOnlyOne: $("#polishOnlyOne").checked,
  };

  if (!payload.product) {
    alert("Please enter a product (or choose a preset).");
    return;
  }

  // Reset UI
  $("#spinner").hidden = false;
  $("#polish").hidden = true;
  $("#offline").hidden = true;
  $("#results").hidden = true;
  $("#variants").innerHTML = "";
  $("#abplan").textContent = "";
  setProgress(12);

  try {
    // 1) Deterministic generation (stateless)
    const data = await postJSON("/generate", payload);
    $("#version").textContent = data.version || "";
    if (!data.aiAvailable) $("#offline").hidden = false;

    // Render variants
    data.variants.forEach((v) => {
      const card = document.createElement("div");
      card.className = "variant";
      card.innerHTML = `
        <h4>${v.channel}</h4>
        <div class="specs">${(v.specs || []).map((s) => `<span>${s}</span>`).join("")}</div>
        <pre class="copy">${v.copy}</pre>
        <p class="rationale"><strong>Why:</strong> ${v.rationale}</p>
        <button class="copyBtn">Copy</button>
      `;
      card.querySelector(".copyBtn").addEventListener("click", () => {
        navigator.clipboard.writeText(v.copy);
        const btn = card.querySelector(".copyBtn");
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy"), 900);
      });
      $("#variants").appendChild(card);
    });

    // A/B plan
    const ab = data.abplan;
    $("#abplan").textContent = `Hypothesis: ${ab.hypothesis}
Variant A: ${ab.variantA}
Variant B: ${ab.variantB}
Primary metric: ${ab.metric}
Run: ${ab.run}`;

    // Deck / CSV / Diagnostics
    $("#copyAll").onclick = () => {
      const everything =
        data.variants
          .map(
            (v) =>
              `${v.channel}\nSpecs: ${(v.specs || []).join(" • ")}\n${v.copy}\nWhy: ${v.rationale}\n`,
          )
          .join("\n") +
        "\nA/B Plan\n" +
        $("#abplan").textContent;

      navigator.clipboard.writeText(everything);
      const b = $("#copyAll");
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = "Copy Deck"), 900);
    };

    $("#downloadCSV").onclick = () => {
      const rows = data.variants.map((v) => ({
        channel: v.channel,
        copy: v.copy,
        specs: v.specs || [],
        rationale: v.rationale || "",
        ab_hypothesis: ab.hypothesis,
        primary_metric: ab.metric,
      }));
      const csv = toCSV(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "variants.csv";
      a.click();
      URL.revokeObjectURL(url);
    };

    $("#diagBtn").onclick = async () => {
      try {
        const d = await (await fetch("/diag")).json();
        alert(JSON.stringify(d, null, 2));
      } catch {
        alert("No diagnostics available.");
      }
    };

    $("#results").hidden = false;
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    setProgress(60);

    // 2) Optional AI polish (token-thrifty)
    if (payload.useAIPolish && data.aiAvailable) {
      $("#polish").hidden = false;
      setProgress(82);
      try {
        const polished = await polishWithTimeout({
          context: {
            product: payload.product,
            audience: payload.audience,
            goal: payload.goal,
            polishOnlyOne: payload.polishOnlyOne,
          },
          variants: data.variants,
        });

        if (polished && polished.polished && Array.isArray(polished.polished)) {
          const copies = document.querySelectorAll(".variant .copy");
          polished.polished.forEach((pv, i) => {
            if (copies[i]) copies[i].textContent = pv.copy;
          });
        }
      } catch (_) {
        // timeout or no key — keep deterministic copy (that’s fine for demo)
      } finally {
        $("#polish").hidden = true;
        setProgress(100);
        setTimeout(() => setProgress(0), 600);
      }
    } else {
      setProgress(100);
      setTimeout(() => setProgress(0), 600);
    }
  } catch (err) {
    alert("Generation failed. " + err.message);
    setProgress(0);
  } finally {
    $("#spinner").hidden = true;
  }
});

// ---------- Judge Mode: auto-cycle presets (?demo=1) ----------
(function () {
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") {
    const order = ["saas", "skincare", "luxury"];
    let i = 0;
    const runNext = () => {
      const k = order[i % order.length];
      const btn = document.querySelector(`.vbtn[data-preset="${k}"]`);
      if (btn) btn.click();
      i++;
      setTimeout(runNext, 22000); // every ~22s to keep pace with talking
    };
    setTimeout(runNext, 800);
  }
})();
