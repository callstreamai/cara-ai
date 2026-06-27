// CARA AI — server
// A consumer-facing chat assistant powered by the Sakana Fugu API.
// The Fugu API key lives ONLY on the server (env var) and is never exposed to the browser.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- Config -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const SAKANA_API_KEY = process.env.SAKANA_API_KEY;
const SAKANA_BASE_URL = process.env.SAKANA_BASE_URL || "https://api.sakana.ai/v1";
const SAKANA_MODEL = process.env.SAKANA_MODEL || "fugu";

// Optional Supabase logging. If these env vars are present, completed
// conversations are persisted to a `cara_messages` table via the REST API.
const SUPABASE_URL = process.env.SUPABASE_URL;            // e.g. https://xxxx.supabase.co
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;   // service_role or secret key
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_KEY);

const SYSTEM_PROMPT =
  process.env.CARA_SYSTEM_PROMPT ||
  [
    "You are CARA, a warm, precise AI assistant by Call Stream AI.",
    "You speak clearly and confidently — short sentences, real nouns, no hype.",
    "State things once and move on. Be genuinely helpful and conversational.",
    "Use Markdown for structure when it helps (lists, code blocks, bold).",
  ].join(" ");

if (!SAKANA_API_KEY) {
  console.warn("[CARA] WARNING: SAKANA_API_KEY is not set. /api/chat will return an error until it is configured.");
}

// ---- Supabase logging (best-effort, non-blocking) -----------------------
async function logToSupabase(rows) {
  if (!SUPABASE_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/cara_messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    console.error("[CARA] Supabase log failed:", err.message);
  }
}

// ---- Health -------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: SAKANA_MODEL,
    keyConfigured: Boolean(SAKANA_API_KEY),
    supabase: SUPABASE_ENABLED,
  });
});

// ---- Chat (SSE streaming proxy to Sakana Fugu) --------------------------
app.post("/api/chat", async (req, res) => {
  if (!SAKANA_API_KEY) {
    return res.status(500).json({ error: "Server is missing SAKANA_API_KEY." });
  }

  const { messages, conversationId } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "`messages` array is required." });
  }

  // Trim to a sane window and enforce shape.
  const cleaned = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  const payload = {
    model: SAKANA_MODEL,
    stream: true,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...cleaned],
  };

  // Set up SSE response to the browser.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const controller = new AbortController();
  let finished = false;
  // Abort upstream only if the CLIENT disconnects before we finish.
  res.on("close", () => {
    if (!finished) controller.abort();
  });

  let assistantText = "";

  try {
    const upstream = await fetch(`${SAKANA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SAKANA_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      finished = true;
      res.write(`event: error\ndata: ${JSON.stringify({ error: `Fugu API error (${upstream.status})`, detail: errText.slice(0, 500) })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines from upstream (OpenAI-compatible: `data: {...}`).
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            assistantText += delta;
            res.write(`event: token\ndata: ${JSON.stringify({ t: delta })}\n\n`);
          }
        } catch {
          // ignore partial / keepalive lines
        }
      }
    }

    finished = true;
    res.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    res.end();

    // Persist (best-effort) after stream completes.
    if (SUPABASE_ENABLED && assistantText) {
      const convo = conversationId || crypto.randomUUID();
      const lastUser = cleaned.filter((m) => m.role === "user").slice(-1)[0]?.content || "";
      logToSupabase([
        { conversation_id: convo, role: "user", content: lastUser },
        { conversation_id: convo, role: "assistant", content: assistantText },
      ]);
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("[CARA] stream error:", err);
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Upstream connection failed." })}\n\n`);
      res.end();
    } catch {
      /* socket already closed */
    }
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`[CARA] listening on :${PORT} — model=${SAKANA_MODEL} supabase=${SUPABASE_ENABLED}`);
});
