// CARA AI — server
// A consumer-facing chat assistant powered by the Sakana Fugu API, with Supabase user accounts.
// The Fugu API key lives ONLY on the server (env var) and is never exposed to the browser.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- Config -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const SAKANA_API_KEY = process.env.SAKANA_API_KEY;
const SAKANA_BASE_URL = process.env.SAKANA_BASE_URL || "https://api.sakana.ai/v1";
const SAKANA_MODEL = process.env.SAKANA_MODEL || "fugu";

// Supabase — used for user accounts + per-user conversation storage.
// SUPABASE_URL and SUPABASE_ANON_KEY are public (the anon key is meant for browsers).
// SUPABASE_SERVICE_KEY stays server-side only.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const SYSTEM_PROMPT =
  process.env.CARA_SYSTEM_PROMPT ||
  [
    "You are CARA, a warm, precise AI assistant by Call Stream AI.",
    "You speak clearly and confidently — short sentences, real nouns, no hype.",
    "State things once and move on. Be genuinely helpful and conversational.",
    "Use Markdown for structure when it helps (lists, code blocks, bold).",
  ].join(" ");

if (!SAKANA_API_KEY) {
  console.warn("[CARA] WARNING: SAKANA_API_KEY is not set. /api/chat will error until it is configured.");
}

// ---- Public client config ----------------------------------------------
// The browser fetches this to initialise the Supabase JS client.
// Only public values are returned — never the service key.
app.get("/api/config", (_req, res) => {
  res.json({
    authEnabled: AUTH_ENABLED,
    supabaseUrl: SUPABASE_URL || null,
    supabaseAnonKey: SUPABASE_ANON_KEY || null,
    model: SAKANA_MODEL,
  });
});

// ---- Health -------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: SAKANA_MODEL,
    keyConfigured: Boolean(SAKANA_API_KEY),
    auth: AUTH_ENABLED,
  });
});

// ---- Auth helper --------------------------------------------------------
// Verifies a Supabase access token by asking Supabase who it belongs to.
// Returns the user object on success, or null.
async function getUserFromToken(token) {
  if (!AUTH_ENABLED || !token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ---- Chat (SSE streaming proxy to Sakana Fugu) --------------------------
app.post("/api/chat", async (req, res) => {
  if (!SAKANA_API_KEY) {
    return res.status(500).json({ error: "Server is missing SAKANA_API_KEY." });
  }

  // When auth is enabled, require a valid signed-in user so the Fugu key
  // can't be abused by anonymous callers.
  if (AUTH_ENABLED) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const user = await getUserFromToken(token);
    if (!user || !user.id) {
      return res.status(401).json({ error: "Please sign in to chat with CARA." });
    }
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "`messages` array is required." });
  }

  const cleaned = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  const payload = {
    model: SAKANA_MODEL,
    stream: true,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...cleaned],
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const controller = new AbortController();
  let finished = false;
  res.on("close", () => {
    if (!finished) controller.abort();
  });

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
            res.write(`event: token\ndata: ${JSON.stringify({ t: delta })}\n\n`);
          }
        } catch {
          /* ignore partial / keepalive lines */
        }
      }
    }

    finished = true;
    res.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    res.end();
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
  console.log(`[CARA] listening on :${PORT} — model=${SAKANA_MODEL} auth=${AUTH_ENABLED}`);
});
