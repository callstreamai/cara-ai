# CARA AI

A consumer-facing chat assistant — ChatGPT/Gemini-style — powered by the **Google Gemini** API and branded for **Call Stream AI**.

CARA has real user accounts: each person signs up, signs in, and gets their own private conversation history. Responses are returned after generation, and your Gemini API key stays safe on the server (never in the browser).

## Stack

- **Node.js + Express** — static frontend + a proxy to Google Gemini
- **Supabase Auth** — Google sign-in restricted to the company domain
- **Supabase Postgres** — per-user conversations + messages, protected by row-level security
- **Vanilla JS frontend** — no build step
- **Server-Sent Events** — response delivery
- **Google Gemini** — OpenAI-compatible chat completions (`gemini-3.1-flash-lite` model)

## How auth works

- The browser fetches `/api/config` to get the public Supabase URL + anon key, then runs Supabase Auth client-side.
- Conversations and messages are stored directly in Supabase, scoped to `auth.uid()` by row-level security — users can only ever see their own data.
- `/api/chat` requires a valid Supabase access token, so the Gemini key can't be used anonymously.

## Local development

```bash
npm install
cp .env.example .env      # then add your keys
npm start                 # http://localhost:3000
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | ✅ | Your Google Gemini API key. Server-side only. |
| `GEMINI_MODEL` | – | Model id. Defaults to `gemini-3.1-flash-lite`. |
| `GEMINI_BASE_URL` | – | Defaults to `https://generativelanguage.googleapis.com/v1beta`. |
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

## Slack search for employees

Employees sign in with their Call Stream Google account and connect their own Slack account. CARA uses Slack Real-time Search to search public and permitted private channels for every question, including bot posts, and supplies message links to Gemini. Direct messages are excluded. Slack and Google email addresses must match. Slack messages are sent to Gemini as context.

Configure `SLACK_CLIENT_ID`, `SLACK_WORKSPACE_ID`, `SLACK_REDIRECT_URI`, and a random `SLACK_SESSION_SECRET` of at least 32 characters. Register the exact HTTPS callback URL in the Slack app, enable PKCE, and configure `search:read.public`, `search:read.private`, `users:read`, and `users:read.email` user scopes. Review all app-required scopes before enabling employee authorization. The user must authorize private channel access in Slack if prompted. Employee Slack connections are encrypted, stored in HttpOnly cookies for seven days, bound to the signed-in account, and cleared on sign-out.

Slack search and identity verification must be configured before chat will operate. If Slack or Gemini is unavailable, CARA returns an error instead of generating an ungrounded company answer.

## Validation

Run `npm test` for cookie encryption, expiry, tampering and PKCE checks. End-to-end Slack OAuth, search permissions, model generation, and deployment require a configured test app and credentials.
