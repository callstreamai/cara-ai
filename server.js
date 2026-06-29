// CARA AI — server
// A consumer-facing chat assistant powered by the Sakana Fugu API, with Supabase user accounts.
// The Fugu API key lives ONLY on the server (env var) and is never exposed to the browser.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
// CommonJS document parsers (loaded lazily inside the route so a missing
// dependency never prevents the server from starting).
const multer = require("multer");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// File uploads held in memory; capped at 15 MB.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const MAX_DOC_CHARS = 120000; // ~30k tokens of context per document

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

// ---- Helper: require a signed-in user (returns user or sends 401) -------
async function requireUser(req, res) {
  if (!AUTH_ENABLED) return { id: "anonymous" };
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const user = await getUserFromToken(token);
  if (!user || !user.id) {
    res.status(401).json({ error: "Please sign in first." });
    return null;
  }
  return user;
}

// ---- Document extraction ------------------------------------------------
// Accepts one uploaded file and returns its plain text so the browser can
// attach it as context to a chat message.
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "log", "rtf",
  "js", "ts", "jsx", "tsx", "py", "java", "c", "cpp", "h", "cs", "go", "rb",
  "php", "rs", "swift", "kt", "sql", "sh", "yaml", "yml", "xml", "html", "css",
]);

app.post("/api/extract", upload.single("file"), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded." });

  const name = file.originalname || "document";
  const ext = (name.split(".").pop() || "").toLowerCase();
  const mime = file.mimetype || "";

  try {
    let text = "";

    if (ext === "pdf" || mime === "application/pdf") {
      const pdfParse = require("pdf-parse/lib/pdf-parse.js");
      const data = await pdfParse(file.buffer);
      text = data.text || "";
    } else if (ext === "docx" || mime.includes("officedocument.wordprocessingml")) {
      const mammoth = require("mammoth");
      const out = await mammoth.extractRawText({ buffer: file.buffer });
      text = out.value || "";
    } else if (ext === "doc") {
      return res.status(415).json({ error: "Old .doc files aren't supported — please save as .docx or PDF." });
    } else if (TEXT_EXTENSIONS.has(ext) || mime.startsWith("text/")) {
      text = file.buffer.toString("utf8");
    } else {
      // Last resort: try UTF-8; if it's mostly binary, reject.
      const guess = file.buffer.toString("utf8");
      const nonPrintable = (guess.match(/[\u0000-\u0008\u000E-\u001F]/g) || []).length;
      if (nonPrintable > guess.length * 0.02) {
        return res.status(415).json({ error: `Unsupported file type: .${ext}. Try PDF, Word (.docx), or a text file.` });
      }
      text = guess;
    }

    text = text.replace(/\u0000/g, "").trim();
    if (!text) {
      return res.status(422).json({ error: "Couldn't find any text in that file. If it's a scanned PDF, it may be images only." });
    }

    const truncated = text.length > MAX_DOC_CHARS;
    if (truncated) text = text.slice(0, MAX_DOC_CHARS);

    res.json({ filename: name, chars: text.length, truncated, text });
  } catch (err) {
    console.error("[CARA] extract error:", err.message);
    if (/xref|invalid pdf|may not be a pdf/i.test(err.message)) {
      return res.status(422).json({ error: "That PDF couldn't be read — it may be corrupted or password-protected." });
    }
    res.status(500).json({ error: "Could not read that file. Please try a different one." });
  }
});

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

  const { messages, attachments } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "`messages` array is required." });
  }

  const cleaned = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  // If documents are attached, prepend their text as context to the latest
  // user message (model-facing only — the stored message stays clean).
  if (Array.isArray(attachments) && attachments.length) {
    let lastUserIdx = -1;
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (cleaned[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx !== -1) {
      const docs = attachments
        .filter((a) => a && typeof a.text === "string" && a.text.trim())
        .slice(0, 5)
        .map((a) => {
          const fname = String(a.filename || "document").slice(0, 200);
          const body = a.text.slice(0, MAX_DOC_CHARS);
          return `<document name="${fname}">\n${body}\n</document>`;
        });
      if (docs.length) {
        const context =
          "The user attached the following document(s). Use them to answer.\n\n" +
          docs.join("\n\n") +
          "\n\n---\n\n";
        cleaned[lastUserIdx] = {
          role: "user",
          content: context + cleaned[lastUserIdx].content,
        };
      }
    }
  }

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
