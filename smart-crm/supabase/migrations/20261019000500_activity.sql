-- =============================================================================
-- SMART CRM AI — notes, attachments, timeline activities, tasks, calendar,
-- notifications.
-- Records that belong to one CRM entity use one nullable composite FK per entity
-- type plus a CHECK on how many may be set — real referential integrity instead
-- of a polymorphic (entity_type, entity_id) pair.
-- =============================================================================

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  contact_id uuid,
  company_id uuid,
  deal_id uuid,
  lead_id uuid,
  pinned boolean not null default false,
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(contact_id, company_id, deal_id, lead_id) = 1),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade
);
create index notes_contact_idx on public.notes (tenant_id, contact_id, created_at desc) where contact_id is not null;
create index notes_company_idx on public.notes (tenant_id, company_id, created_at desc) where company_id is not null;
create index notes_deal_idx on public.notes (tenant_id, deal_id, created_at desc) where deal_id is not null;
create index notes_lead_idx on public.notes (tenant_id, lead_id, created_at desc) where lead_id is not null;

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid,
  company_id uuid,
  deal_id uuid,
  lead_id uuid,
  storage_key text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) <= 127),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (num_nonnulls(contact_id, company_id, deal_id, lead_id) = 1),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade
);
create index attachments_contact_idx on public.attachments (tenant_id, contact_id) where contact_id is not null;
create index attachments_company_idx on public.attachments (tenant_id, company_id) where company_id is not null;
create index attachments_deal_idx on public.attachments (tenant_id, deal_id) where deal_id is not null;
create index attachments_lead_idx on public.attachments (tenant_id, lead_id) where lead_id is not null;

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null check (type in (
    'note', 'call', 'meeting', 'email', 'whatsapp_in', 'whatsapp_out',
    'task_created', 'task_completed', 'deal_created', 'deal_stage_changed', 'deal_won', 'deal_lost',
    'lead_created', 'lead_converted', 'contact_created', 'company_created', 'file_uploaded',
    'quote_created', 'quote_sent', 'quote_status', 'automation', 'ai', 'consent_changed', 'merged'
  )),
  subject text check (char_length(subject) <= 300),
  body text check (char_length(body) <= 10000),
  contact_id uuid,
  company_id uuid,
  deal_id uuid,
  lead_id uuid,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'automation', 'ai', 'contact', 'api_key')),
  occurred_at timestamptz not null default now(),
  duration_minutes integer check (duration_minutes between 0 and 1440),
  outcome text check (char_length(outcome) <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (num_nonnulls(contact_id, company_id, deal_id, lead_id) >= 1),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade
);
create index activities_contact_idx on public.activities (tenant_id, contact_id, occurred_at desc) where contact_id is not null;
create index activities_company_idx on public.activities (tenant_id, company_id, occurred_at desc) where company_id is not null;
create index activities_deal_idx on public.activities (tenant_id, deal_id, occurred_at desc) where deal_id is not null;
create index activities_lead_idx on public.activities (tenant_id, lead_id, occurred_at desc) where lead_id is not null;
create index activities_tenant_idx on public.activities (tenant_id, occurred_at desc);
create index activities_actor_idx on public.activities (tenant_id, actor_id, occurred_at desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 5000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'canceled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  due_at timestamptz,
  remind_at timestamptz,
  reminder_sent_at timestamptz,
  assignee_id uuid,
  is_team_task boolean not null default false,
  contact_id uuid,
  company_id uuid,
  deal_id uuid,
  lead_id uuid,
  conversation_id uuid,
  source text not null default 'manual' check (source in ('manual', 'ai', 'automation', 'api')),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check ((status = 'done') = (completed_at is not null)),
  foreign key (tenant_id, assignee_id) references public.memberships (tenant_id, user_id) on delete set null (assignee_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id) on delete set null (conversation_id)
);
create index tasks_assignee_idx on public.tasks (tenant_id, assignee_id, status, due_at);
create index tasks_due_idx on public.tasks (tenant_id, due_at) where status in ('open', 'in_progress');
create index tasks_reminder_idx on public.tasks (remind_at) where reminder_sent_at is null and status in ('open', 'in_progress');
create index tasks_contact_idx on public.tasks (tenant_id, contact_id) where contact_id is not null;
create index tasks_deal_idx on public.tasks (tenant_id, deal_id) where deal_id is not null;

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 5000),
  location text check (char_length(location) <= 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  owner_id uuid,
  contact_id uuid,
  company_id uuid,
  deal_id uuid,
  external_provider text check (external_provider in ('google', 'microsoft')),
  external_id text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at),
  check ((external_provider is null) = (external_id is null)),
  foreign key (tenant_id, owner_id) references public.memberships (tenant_id, user_id) on delete set null (owner_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete cascade
);
create index calendar_events_range_idx on public.calendar_events (tenant_id, starts_at, ends_at);
create unique index calendar_events_external_idx on public.calendar_events (tenant_id, external_provider, external_id)
  where external_id is not null;

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  provider text not null check (provider in ('google', 'microsoft')),
  status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'revoked')),
  account_email text,
  secret_id uuid references public.secrets (id) on delete set null,
  scopes text[] not null default '{}',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, provider),
  foreign key (tenant_id, user_id) references public.memberships (tenant_id, user_id) on delete cascade
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (char_length(type) between 3 and 60),
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 1000),
  link text check (link ~ '^/[^/]'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, tenant_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id, tenant_id) where read_at is null;

create table public.notification_preferences (
  tenant_id uuid not null,
  user_id uuid not null,
  event_type text not null check (event_type in (
    'conversation_assigned', 'message_received', 'task_assigned', 'task_reminder',
    'deal_won', 'deal_lost', 'lead_assigned', 'mention', 'ai_proposal', 'automation_failed', 'invitation_accepted'
  )),
  in_app boolean not null default true,
  email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, event_type),
  foreign key (tenant_id, user_id) references public.memberships (tenant_id, user_id) on delete cascade
);

select app.enable_tenant_rls('public.notes');
select app.enable_tenant_rls('public.attachments');
select app.enable_tenant_rls('public.activities');
select app.enable_tenant_rls('public.tasks');
select app.enable_tenant_rls('public.calendar_events');

-- Personal rows: visible and writable only by their user.
alter table public.calendar_connections enable row level security;
grant select, delete on public.calendar_connections to crm_app;
create policy own_read on public.calendar_connections for select to crm_app
  using (user_id = (select app.current_user_id()) and tenant_id in (select app.readable_tenant_ids()));
create policy own_delete on public.calendar_connections for delete to crm_app
  using (user_id = (select app.current_user_id()) and tenant_id in (select app.writable_tenant_ids()));

alter table public.notifications enable row level security;
grant select, update (read_at), delete on public.notifications to crm_app;
grant insert on public.notifications to crm_app;
create policy own_read on public.notifications for select to crm_app
  using (user_id = (select app.current_user_id()) and tenant_id in (select app.readable_tenant_ids()));
create policy own_update on public.notifications for update to crm_app
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));
create policy own_delete on public.notifications for delete to crm_app
  using (user_id = (select app.current_user_id()));
-- Any member may notify another member of the same tenant (e.g. on assignment).
create policy member_insert on public.notifications for insert to crm_app
  with check (
    tenant_id in (select app.writable_tenant_ids())
    and exists (select 1 from public.memberships m where m.tenant_id = notifications.tenant_id and m.user_id = notifications.user_id and m.status = 'active')
  );

grant select on public.notifications to authenticated;
create policy realtime_read on public.notifications for select to authenticated
  using (user_id = (select app.current_user_id()));

alter table public.notification_preferences enable row level security;
grant select, insert, update, delete on public.notification_preferences to crm_app;
create policy own_all on public.notification_preferences for all to crm_app
  using (user_id = (select app.current_user_id()) and tenant_id in (select app.readable_tenant_ids()))
  with check (user_id = (select app.current_user_id()) and tenant_id in (select app.writable_tenant_ids()));
