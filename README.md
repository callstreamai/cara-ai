# CARA AI

A consumer-facing chat assistant — ChatGPT/Gemini-style — powered by the **Sakana Fugu** API and branded for **Call Stream AI**.

CARA streams responses in real time, keeps multiple conversations, and keeps your Fugu API key safe on the server (never in the browser).

## Stack

- **Node.js + Express** — static frontend + a streaming proxy to Sakana Fugu
- **Vanilla JS frontend** — no build step, multi-conversation history (localStorage)
- **Server-Sent Events** — live token streaming
- **Sakana Fugu** — OpenAI-compatible chat completions (`fugu` model)
- **Supabase** *(optional)* — conversation logging

## Local development

```bash
npm install
cp .env.example .env      # then add your SAKANA_API_KEY
npm start                 # http://localhost:3000
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `SAKANA_API_KEY` | yes | Your Sakana Fugu API key. Server-side only. |
| `SAKANA_MODEL` | - | Model id. Defaults to `fugu` (`fugu-ultra` also available). |
| `SAKANA_BASE_URL` | - | Defaults to `https://api.sakana.ai/v1`. |
| `CARA_SYSTEM_PROMPT` | - | Override CARA's persona. |
| `SUPABASE_URL` | - | Enable conversation logging (with the key below). |
| `SUPABASE_SERVICE_KEY` | - | Supabase service-role / secret key. |

## Deploy on Render

This repo includes `render.yaml`. Create a new **Web Service** from the GitHub repo, then set `SAKANA_API_KEY` as an environment variable. Build: `npm install`. Start: `npm start`.

## Optional: Supabase logging

Run `supabase_schema.sql` in your Supabase SQL editor, then set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Completed turns are written to `cara_messages`.

---

Call Stream AI
