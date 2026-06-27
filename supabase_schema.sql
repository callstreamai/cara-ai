-- CARA AI — schema for user accounts + per-user conversation storage.
-- Run this in your Supabase project's SQL editor (or via the Management API).
-- Row-level security ensures each user can only see their own data.

-- ---------- Conversations ----------
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists conversations_user_idx
  on public.conversations (user_id, updated_at desc);

-- ---------- Messages ----------
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  created_at       timestamptz not null default now()
);

create index if not exists messages_convo_idx
  on public.messages (conversation_id, created_at);

-- ---------- Row-level security ----------
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
