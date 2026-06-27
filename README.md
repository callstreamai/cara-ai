# CARA AI

A consumer-facing chat assistant — ChatGPT/Gemini-style — powered by the **Sakana Fugu** API and branded for **Call Stream AI**.

CARA has real user accounts: each person signs up, signs in, and gets their own private conversation history. Responses stream in real time, and your Fugu API key stays safe on the server (never in the browser).

## Stack

- **Node.js + Express** — static frontend + a streaming proxy to Sakana Fugu
- **Supabase Auth** — email/password user accounts
- **Supabase Postgres** — per-user conversations + messages, protected by row-level security
- **Vanilla JS frontend** — no build step
- **Server-Sent Events** — live token streaming
- **Sakana Fugu** — OpenAI-compatible chat completions (`fugu` model)

## How auth works

- The browser fetches `/api/config` to get the public Supabase URL + anon key, then runs Supabase Auth client-side.
- Conversations and messages are stored directly in Supabase, scoped to `auth.uid()` by row-level security — users can only ever see their own data.
- `/api/chat` requires a valid Supabase access token, so the Fugu key can't be used anonymously.

## Local development

```bash
npm install
cp .env.example .env      # then add your keys
npm start                 # http://localhost:3000
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `SAKANA_API_KEY` | ✅ | Your Sakana Fugu API key. Server-side only. |
| `SAKANA_MODEL` | – | Model id. Defaults to `fugu` (`fugu-ultra` also available). |
| `SAKANA_BASE_URL` | – | Defaults to `https://api.sakana.ai/v1`. |
| `CARA_SYSTEM_PROMPT` | – | Override CARA's persona. |
| `SUPABASE_URL` | ✅ | Your Supabase project URL. Public. |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anon key. Public (browser-safe). |
| `SUPABASE_SERVICE_KEY` | – | Supabase service-role key. Server-side only. |

## Deploy on Render

This repo includes `render.yaml`. Create a new **Web Service** from the GitHub repo, then set the environment variables above. Build: `npm install`. Start: `npm start`.

## Database setup

Run `supabase_schema.sql` in your Supabase SQL editor (or via the Management API). It creates `conversations` and `messages` tables with row-level security so each user only sees their own data.

---

© Call Stream AI
