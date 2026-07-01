-- ============================================================
--  NUTROLIS AI · Migration 002 — Report translation cache
--  Run in: Supabase Dashboard -> SQL Editor -> New query
--
--  Purpose: store ONE English master report + cache per-language
--  translations so we never re-call Claude for a language we've
--  already produced. Safe to run multiple times (idempotent).
-- ============================================================

-- ---------- 1. Canonical master + invalidation hash on reports ----------
-- master_json holds the structured English report (snapshot, summary,
-- good_news[], attention[], questions[]). content_hash lets the client
-- detect regeneration and discard stale translations.
alter table public.reports
  add column if not exists master_json  jsonb,
  add column if not exists content_hash text;

-- ---------- 2. Translation cache ----------
create table if not exists public.report_translations (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.reports(id) on delete cascade,
  user_id      uuid not null references auth.users(id)     on delete cascade,
  lang         text not null,                 -- 'hi' | 'ta' | 'ar' | ...
  content_hash text not null,                 -- must match reports.content_hash
  content      jsonb not null,                -- translated master (strings only)
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (report_id, lang)                    -- one cached row per language
);

create index if not exists report_translations_lookup_idx
  on public.report_translations (report_id, lang);
create index if not exists report_translations_user_idx
  on public.report_translations (user_id);

-- keep updated_at fresh on upsert-update
drop trigger if exists report_translations_touch on public.report_translations;
create trigger report_translations_touch
  before update on public.report_translations
  for each row execute function public.touch_updated_at();

-- ---------- 3. Row Level Security — user sees only their own rows ----------
alter table public.report_translations enable row level security;

drop policy if exists "own translations read"   on public.report_translations;
drop policy if exists "own translations write"  on public.report_translations;
drop policy if exists "own translations update" on public.report_translations;
drop policy if exists "own translations delete" on public.report_translations;

create policy "own translations read"
  on public.report_translations for select using (auth.uid() = user_id);
create policy "own translations write"
  on public.report_translations for insert with check (auth.uid() = user_id);
create policy "own translations update"
  on public.report_translations for update using (auth.uid() = user_id);
create policy "own translations delete"
  on public.report_translations for delete using (auth.uid() = user_id);

-- Done. Translations cascade-delete with their parent report, so
-- deleting a report or clearing all data automatically clears its cache.
