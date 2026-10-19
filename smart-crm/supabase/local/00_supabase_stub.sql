-- =============================================================================
-- LOCAL DEVELOPMENT / CI ONLY — never run against a real Supabase project.
--
-- Recreates the small part of Supabase that SMART CRM AI's migrations depend on,
-- so the schema, RLS policies and the whole app can be exercised on plain
-- PostgreSQL 16:  auth.users, auth.uid(), the anon/authenticated/service_role
-- roles and the `extensions` schema. It also holds tables used only by the
-- LocalAuthAdapter (sessions, one-time tokens, TOTP factors).
-- =============================================================================

create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Subset of Supabase's auth.users (same column names).
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same semantics as Supabase: the user id comes from the request JWT claims.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

-- LocalAuthAdapter tables (local only; Supabase Auth manages its own equivalents).
create table if not exists auth.local_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  aal text not null default 'aal1' check (aal in ('aal1', 'aal2')),
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists local_sessions_user_idx on auth.local_sessions (user_id);

create table if not exists auth.local_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('email_verification', 'password_reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists auth.local_mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  secret text not null,
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  last_used_step bigint,
  created_at timestamptz not null default now()
);
create index if not exists local_mfa_user_idx on auth.local_mfa_factors (user_id);

grant usage on schema auth, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
