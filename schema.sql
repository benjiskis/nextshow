-- Concert Tour Wishlist App — Database Schema
-- Version: 1.0.5
-- Target: Supabase (Postgres)
-- Notes: Auth is Firebase (Google OAuth popup), NOT Supabase Auth.
--        `firebase_uid` is the link between a Firebase-authenticated
--        user and their row here — no Supabase auth.users table involved.
--        Since there's no Supabase-native auth.uid(), RLS can't scope rows
--        per user. Policies below just allow the anon key full access —
--        prototype-stage tradeoff, revisit before this holds real user data.

-- ─── Users ───────────────────────────────────────────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  firebase_uid  text unique not null,
  email         text not null,
  display_name  text,
  city          text,
  state         text,
  country       text,
  latitude      double precision,
  longitude     double precision,
  created_at    timestamptz not null default now()
);

-- ─── Groups (friend groups sharing a wishlist) ─────────────
create table groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table group_members (
  group_id  uuid references groups(id) on delete cascade,
  user_id   uuid references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ─── Artists ─────────────────────────────────────────────
-- One row per artist, cross-referenced by external source IDs
-- so ingestion jobs can upsert without re-matching by name.
create table artists (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  jambase_id               text unique,
  ticketmaster_id          text unique,
  bandsintown_id           text unique,
  logo_url                 text,
  -- Set only once a source's *events* have actually been fetched for this
  -- artist (success or confirmed-empty) — NOT when the *_id is resolved.
  -- Adding an artist via the live Ticketmaster typeahead resolves
  -- ticketmaster_id immediately but doesn't fetch its shows, so this is
  -- what "Check for shows" (Wishlist.jsx) actually keys off of.
  ticketmaster_checked_at  timestamptz,
  jambase_checked_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index idx_artists_name on artists (name);

-- ─── Wishlist ────────────────────────────────────────────
create table wishlist_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  artist_id   uuid not null references artists(id) on delete cascade,
  group_id    uuid references groups(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, artist_id)
);

-- ─── Shows (tour dates pulled from ingestion) ──────────────
create table shows (
  id              uuid primary key default gen_random_uuid(),
  artist_id       uuid not null references artists(id) on delete cascade,
  venue_name      text,
  venue_url       text,
  city            text,
  state           text,
  country         text,
  latitude        double precision,
  longitude       double precision,
  event_date      timestamptz not null,
  ticket_url      text,
  source          text not null,       -- 'jambase' | 'ticketmaster' | 'bandsintown'
  source_event_id text not null,       -- ID from that source, for de-dup/upsert
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source, source_event_id)
);

create index idx_shows_artist_date on shows (artist_id, event_date);
create index idx_shows_event_date on shows (event_date);

-- ─── Show interest (the "who's in" voting layer) ───────────
create table show_interest (
  show_id     uuid not null references shows(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  vote        text not null check (vote in ('yes', 'no', 'maybe')),
  created_at  timestamptz not null default now(),
  primary key (show_id, user_id)
);

-- ─── Row-level security ─────────────────────────────────────
-- No Supabase Auth session exists (auth is Firebase-only), so every
-- request from the browser hits these tables as the `anon` role.
-- Allow anon full access for now — see note at top of file.
-- TODO(later feature): replace with a server-side Edge Function (service_role
-- key, verifies the Firebase ID token) so writes are scoped per-user instead
-- of anon-wide. Revisit before this holds real user data.
alter table users          enable row level security;
alter table groups         enable row level security;
alter table group_members  enable row level security;
alter table artists        enable row level security;
alter table wishlist_items enable row level security;
alter table shows          enable row level security;
alter table show_interest  enable row level security;

create policy "anon full access" on users          for all to anon using (true) with check (true);
create policy "anon full access" on groups         for all to anon using (true) with check (true);
create policy "anon full access" on group_members  for all to anon using (true) with check (true);
create policy "anon full access" on artists        for all to anon using (true) with check (true);
create policy "anon full access" on wishlist_items for all to anon using (true) with check (true);
create policy "anon full access" on shows          for all to anon using (true) with check (true);
create policy "anon full access" on show_interest  for all to anon using (true) with check (true);
