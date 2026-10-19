-- =============================================================================
-- SMART CRM AI — foundation: roles, helper schema, identity, tenancy, platform
-- infrastructure (jobs, webhooks, audit, rate limits, flags, secrets).
--
-- Database roles
--   crm_app        server-side role for every user-initiated request. All RLS
--                  policies target it. Not reachable through Supabase's Data API.
--   authenticated  Supabase browser role: SELECT on realtime tables only.
--   anon           nothing.
--   owner/postgres system context (webhooks, worker, admin) — bypasses RLS.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
revoke all on schema app from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_app') then
    create role crm_app nologin noinherit;
  end if;
end
$$;

-- The migration owner (postgres on Supabase) must be able to `SET ROLE crm_app`.
grant crm_app to current_user;
grant usage on schema public, app, extensions to crm_app;
grant usage on schema app to authenticated;

-- Supabase grants every new public table to anon/authenticated by default.
-- This app exposes nothing through the Data API unless explicitly granted.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema app revoke all on functions from public;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable
set search_path = ''
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- Identity
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  avatar_path text,
  locale text not null default 'he' check (locale in ('he', 'en')),
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  is_super_admin boolean not null default false,
  last_tenant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

-- -----------------------------------------------------------------------------
-- Tenancy
-- -----------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  locale text not null default 'he' check (locale in ('he', 'en')),
  timezone text not null default 'Asia/Jerusalem' check (char_length(timezone) <= 64),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  brand_color text check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_path text,
  website text check (char_length(website) <= 300),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 254),
  address text check (char_length(address) <= 300),
  tax_id text check (char_length(tax_id) <= 40),
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_after timestamptz
);

alter table public.profiles
  add constraint profiles_last_tenant_fk foreign key (last_tenant_id)
  references public.tenants (id) on delete set null;

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'agent')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  role text not null check (role in ('owner', 'manager', 'agent')),
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_pending_email_idx
  on public.invitations (tenant_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- Platform-admin "support mode": read-only access to one tenant, time boxed.
create table public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 500),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  check (expires_at > started_at and expires_at <= started_at + interval '4 hours')
);
create index support_sessions_admin_idx on public.support_sessions (admin_user_id) where ended_at is null;

-- -----------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER: they read memberships without
-- recursing into memberships' own policies).
-- -----------------------------------------------------------------------------
create or replace function app.readable_tenant_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.memberships m
  join public.tenants tn on tn.id = m.tenant_id and tn.deleted_at is null
  where m.user_id = app.current_user_id() and m.status = 'active'
  union
  select s.tenant_id
  from public.support_sessions s
  join public.profiles p on p.id = s.admin_user_id and p.is_super_admin
  where s.admin_user_id = app.current_user_id()
    and s.ended_at is null
    and s.expires_at > now()
$$;

create or replace function app.writable_tenant_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.memberships m
  join public.tenants tn on tn.id = m.tenant_id
   and tn.deleted_at is null
   and tn.status = 'active'
  where m.user_id = app.current_user_id() and m.status = 'active'
$$;

create or replace function app.has_tenant_role(p_tenant_id uuid, p_roles text[]) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenants tn on tn.id = m.tenant_id
     and tn.deleted_at is null
     and tn.status = 'active'
    where m.tenant_id = p_tenant_id
      and m.user_id = app.current_user_id()
      and m.status = 'active'
      and m.role = any (p_roles)
  )
$$;

-- Users that share at least one tenant with the current user (for names/avatars).
create or replace function app.visible_user_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct m.user_id
  from public.memberships m
  where m.tenant_id in (select app.readable_tenant_ids())
$$;

revoke all on function app.readable_tenant_ids() from public;
revoke all on function app.writable_tenant_ids() from public;
revoke all on function app.has_tenant_role(uuid, text[]) from public;
revoke all on function app.visible_user_ids() from public;
revoke all on function app.current_user_id() from public;
grant execute on function app.readable_tenant_ids(), app.writable_tenant_ids(),
  app.has_tenant_role(uuid, text[]), app.visible_user_ids(), app.current_user_id()
  to crm_app, authenticated;

-- Applies the standard tenant policy set to a table with a tenant_id column.
-- p_manage_roles = null  → any active member may write
-- p_manage_roles = {...} → only these membership roles may write
create or replace function app.enable_tenant_rls(p_table regclass, p_manage_roles text[] default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  write_check text;
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('grant select, insert, update, delete on %s to crm_app', p_table);

  if p_manage_roles is null then
    write_check := 'tenant_id in (select app.writable_tenant_ids())';
  else
    write_check := format(
      'tenant_id in (select app.writable_tenant_ids()) and app.has_tenant_role(tenant_id, %L::text[])',
      p_manage_roles
    );
  end if;

  execute format(
    'create policy tenant_read on %s for select to crm_app using (tenant_id in (select app.readable_tenant_ids()))',
    p_table
  );
  execute format('create policy tenant_insert on %s for insert to crm_app with check (%s)', p_table, write_check);
  execute format('create policy tenant_update on %s for update to crm_app using (%s) with check (%s)', p_table, write_check, write_check);
  execute format('create policy tenant_delete on %s for delete to crm_app using (%s)', p_table, write_check);
end
$$;
revoke all on function app.enable_tenant_rls(regclass, text[]) from public;

-- -----------------------------------------------------------------------------
-- New auth user → profile
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, locale)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    case when new.raw_user_meta_data ->> 'locale' in ('he', 'en')
         then new.raw_user_meta_data ->> 'locale' else 'he' end
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create or replace function app.handle_auth_user_email_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end
$$;
revoke all on function app.handle_new_auth_user() from public;
revoke all on function app.handle_auth_user_email_change() from public;

create trigger smart_crm_on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();
create trigger smart_crm_on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function app.handle_auth_user_email_change();

-- A tenant must always keep at least one active owner.
create or replace function app.ensure_tenant_has_owner() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.status = 'active'
     and exists (select 1 from public.tenants t where t.id = old.tenant_id)
     and not exists (
       select 1 from public.memberships m
       where m.tenant_id = old.tenant_id and m.role = 'owner' and m.status = 'active'
     )
  then
    raise exception 'tenant % must keep at least one active owner', old.tenant_id
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
revoke all on function app.ensure_tenant_has_owner() from public;
create trigger memberships_keep_owner
  after update or delete on public.memberships
  for each row execute function app.ensure_tenant_has_owner();

-- -----------------------------------------------------------------------------
-- Audit log (append-only for application roles)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'system', 'api_key', 'ai', 'admin', 'webhook', 'automation')),
  action text not null check (char_length(action) between 3 and 100),
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_idx on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (tenant_id, entity_type, entity_id);
create index audit_logs_platform_idx on public.audit_logs (created_at desc) where tenant_id is null;

-- -----------------------------------------------------------------------------
-- Secrets: encrypted credentials. Never readable by crm_app/authenticated.
-- -----------------------------------------------------------------------------
create table public.secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('whatsapp_access_token', 'whatsapp_app_secret', 'webhook_signing', 'integration', 'calendar_oauth', 'automation_webhook')),
  ciphertext text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
create index secrets_tenant_idx on public.secrets (tenant_id);

-- -----------------------------------------------------------------------------
-- Durable job queue
-- -----------------------------------------------------------------------------
create table public.jobs (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants (id) on delete cascade,
  type text not null check (char_length(type) between 3 and 80),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'dead', 'canceled')),
  priority integer not null default 0,
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 50),
  last_error text,
  idempotency_key text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index jobs_idempotency_idx on public.jobs (idempotency_key) where idempotency_key is not null;
create index jobs_ready_idx on public.jobs (priority desc, run_at, id) where status = 'queued';
create index jobs_running_idx on public.jobs (locked_at) where status = 'running';
create index jobs_dead_idx on public.jobs (tenant_id, finished_at desc) where status = 'dead';

-- -----------------------------------------------------------------------------
-- Inbound webhook store (deduplication + audit trail)
-- -----------------------------------------------------------------------------
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('whatsapp', 'billing', 'automation')),
  event_key text not null,
  tenant_id uuid references public.tenants (id) on delete cascade,
  signature_valid boolean not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  attempts integer not null default 0,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_key)
);
create index webhook_events_status_idx on public.webhook_events (provider, status, received_at);

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed window counters, system context only)
-- -----------------------------------------------------------------------------
create table public.rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
create index rate_limit_counters_window_idx on public.rate_limit_counters (window_start);

-- -----------------------------------------------------------------------------
-- Feature flags
-- -----------------------------------------------------------------------------
create table public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_.-]{2,64}$'),
  description text not null default '',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_feature_flags (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  flag_key text not null references public.feature_flags (key) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, flag_key)
);

-- -----------------------------------------------------------------------------
-- Email outbox (delivery log; the dev mailbox reads from here). System only.
-- -----------------------------------------------------------------------------
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  to_email text not null,
  subject text not null,
  html text not null,
  text_body text not null default '',
  template text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'logged')),
  provider text not null,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_to_idx on public.email_outbox (lower(to_email), created_at desc);

-- -----------------------------------------------------------------------------
-- Row level security for this file's tables
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
grant select on public.profiles to crm_app;
grant update (full_name, avatar_path, locale, theme, last_tenant_id) on public.profiles to crm_app;
create policy profiles_read on public.profiles for select to crm_app
  using (id = (select app.current_user_id()) or id in (select app.visible_user_ids()));
create policy profiles_update_self on public.profiles for update to crm_app
  using (id = (select app.current_user_id()))
  with check (id = (select app.current_user_id()));

alter table public.tenants enable row level security;
grant select on public.tenants to crm_app;
grant update (name, locale, timezone, currency, brand_color, logo_path, website, phone, email, address, tax_id, settings)
  on public.tenants to crm_app;
create policy tenants_read on public.tenants for select to crm_app
  using (id in (select app.readable_tenant_ids()));
create policy tenants_update on public.tenants for update to crm_app
  using (id in (select app.writable_tenant_ids()) and app.has_tenant_role(id, '{owner,manager}'))
  with check (id in (select app.writable_tenant_ids()) and app.has_tenant_role(id, '{owner,manager}'));

alter table public.memberships enable row level security;
grant select, update, delete on public.memberships to crm_app;
create policy memberships_read on public.memberships for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));
create policy memberships_update on public.memberships for update to crm_app
  using (app.has_tenant_role(tenant_id, '{owner,manager}'))
  with check (app.has_tenant_role(tenant_id, '{owner,manager}'));
create policy memberships_delete on public.memberships for delete to crm_app
  using (app.has_tenant_role(tenant_id, '{owner,manager}'));

select app.enable_tenant_rls('public.invitations', '{owner,manager}');

alter table public.support_sessions enable row level security; -- system only

alter table public.audit_logs enable row level security;
grant select, insert on public.audit_logs to crm_app;
create policy audit_read on public.audit_logs for select to crm_app
  using (tenant_id is not null and app.has_tenant_role(tenant_id, '{owner,manager}'));
create policy audit_insert on public.audit_logs for insert to crm_app
  with check (
    tenant_id in (select app.writable_tenant_ids())
    and actor_user_id = (select app.current_user_id())
  );

alter table public.secrets enable row level security;            -- system only
alter table public.rate_limit_counters enable row level security; -- system only
alter table public.webhook_events enable row level security;      -- system only
alter table public.email_outbox enable row level security;        -- system only

alter table public.jobs enable row level security;
grant select, insert on public.jobs to crm_app;
create policy jobs_read on public.jobs for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));
create policy jobs_insert on public.jobs for insert to crm_app
  with check (tenant_id in (select app.writable_tenant_ids()) and status = 'queued' and attempts = 0);

alter table public.feature_flags enable row level security;
grant select on public.feature_flags to crm_app;
create policy feature_flags_read on public.feature_flags for select to crm_app using (true);

alter table public.tenant_feature_flags enable row level security;
grant select on public.tenant_feature_flags to crm_app;
create policy tenant_flags_read on public.tenant_feature_flags for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));
