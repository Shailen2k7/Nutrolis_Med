-- ============================================================
--  NUTROLIS AI  ·  Database schema (Supabase / Postgres)
--  Privacy-first: we NEVER store the uploaded file.
--  Only extracted text + structured findings + trends are kept.
--  Run this once in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ---------- PROFILES -----------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  age           int,
  gender        text,                       -- optional
  health_history text,                      -- optional, free text
  allergies     text,                       -- optional
  medications   text,                       -- optional
  lifestyle     text,                       -- optional
  language      text default 'en',
  theme         text default 'light',
  notifications boolean default true,
  onboarded     boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ---------- REPORTS ------------------------------------------
-- One row per uploaded report. The original file is discarded
-- after processing; we keep only the derived intelligence.
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text,                       -- e.g. "Complete Blood Count"
  report_type   text,                       -- blood | mri | ct | ultrasound | xray | prescription | other
  report_date   date,                       -- date on the report if detected
  extracted_text text,                      -- raw OCR / parsed text (no file kept)
  summary       text,                       -- plain-language "what it means"
  snapshot      text,                       -- one-line health snapshot
  health_score  int,                        -- 0-100 derived score for this report
  good_news     jsonb default '[]'::jsonb,  -- positive findings  [string]
  attention     jsonb default '[]'::jsonb,  -- areas to watch     [string]
  questions     jsonb default '[]'::jsonb,  -- questions for the doctor [string]
  ai_source     text default 'engine',      -- 'claude' | 'engine'
  created_at    timestamptz default now()
);
create index if not exists reports_user_idx  on public.reports(user_id);
create index if not exists reports_date_idx  on public.reports(user_id, report_date);

-- ---------- MARKERS ------------------------------------------
-- Individual measured values (Hemoglobin = 11.2 g/dL etc.).
-- These power the dashboard trends and the educational drawer.
create table if not exists public.markers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  report_id     uuid references public.reports(id) on delete cascade,
  key           text not null,              -- canonical key e.g. 'hemoglobin'
  label         text,                       -- display label e.g. 'Haemoglobin'
  value         numeric,
  unit          text,
  ref_low       numeric,
  ref_high      numeric,
  status        text,                       -- 'low' | 'normal' | 'high'
  body_area     text,                       -- 'blood' | 'liver' | 'kidney' | 'thyroid' | 'heart' | 'brain' ...
  report_date   date,
  created_at    timestamptz default now()
);
create index if not exists markers_user_key_idx on public.markers(user_id, key, report_date);

-- ---------- updated_at helper --------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- auto-create profile on signup --------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
--  ROW LEVEL SECURITY  — every user sees ONLY their own data
-- ============================================================
alter table public.profiles enable row level security;
alter table public.reports  enable row level security;
alter table public.markers  enable row level security;

-- profiles
drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile write"  on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile write"  on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- reports
drop policy if exists "own reports read"   on public.reports;
drop policy if exists "own reports write"  on public.reports;
drop policy if exists "own reports delete" on public.reports;
create policy "own reports read"   on public.reports for select using (auth.uid() = user_id);
create policy "own reports write"  on public.reports for insert with check (auth.uid() = user_id);
create policy "own reports delete" on public.reports for delete using (auth.uid() = user_id);

-- markers
drop policy if exists "own markers read"   on public.markers;
drop policy if exists "own markers write"  on public.markers;
drop policy if exists "own markers delete" on public.markers;
create policy "own markers read"   on public.markers for select using (auth.uid() = user_id);
create policy "own markers write"  on public.markers for insert with check (auth.uid() = user_id);
create policy "own markers delete" on public.markers for delete using (auth.uid() = user_id);

-- Done. No storage buckets are created — files are never persisted.
