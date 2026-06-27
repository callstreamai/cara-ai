-- CARA AI — optional conversation logging table.
-- Run this in your Supabase project's SQL editor if you want server-side logging.

create table if not exists public.cara_messages (
  id          bigint generated always as identity primary key,
  conversation_id text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists cara_messages_convo_idx
  on public.cara_messages (conversation_id, created_at);
