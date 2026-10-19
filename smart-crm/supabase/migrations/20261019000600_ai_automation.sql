-- =============================================================================
-- SMART CRM AI — AI copilot metering/approvals and the automation engine.
-- =============================================================================

create table public.ai_interactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  feature text not null check (feature in (
    'summarize', 'draft_reply', 'intent', 'classify_lead', 'next_actions',
    'generate_tasks', 'search', 'trends', 'chat'
  )),
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 80),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  latency_ms integer check (latency_ms >= 0),
  status text not null check (status in ('ok', 'error', 'rate_limited', 'quota_exceeded', 'blocked')),
  error text,
  entity_type text check (entity_type in ('contact', 'company', 'deal', 'lead', 'conversation')),
  entity_id uuid,
  output jsonb,
  created_at timestamptz not null default now()
);
create index ai_interactions_tenant_idx on public.ai_interactions (tenant_id, created_at desc);
create index ai_interactions_user_idx on public.ai_interactions (tenant_id, user_id, created_at desc);

create table public.ai_action_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  interaction_id uuid references public.ai_interactions (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  action_type text not null check (action_type in (
    'create_task', 'update_deal_stage', 'update_lead_status', 'send_whatsapp_message',
    'assign_conversation', 'add_note', 'add_tag'
  )),
  payload jsonb not null,
  rationale text check (char_length(rationale) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  error text,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
create index ai_proposals_pending_idx on public.ai_action_proposals (tenant_id, status, created_at desc);

create table public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  trigger_type text not null check (char_length(trigger_type) between 3 and 60),
  definition jsonb not null,
  published_version integer,
  max_runs_per_entity_per_day integer not null default 10 check (max_runs_per_entity_per_day between 1 and 1000),
  webhook_token_hash text unique,
  next_scheduled_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (status <> 'active' or published_version is not null)
);
create index automation_workflows_trigger_idx on public.automation_workflows (tenant_id, trigger_type) where status = 'active';
create index automation_workflows_schedule_idx on public.automation_workflows (next_scheduled_at) where status = 'active' and next_scheduled_at is not null;

create table public.automation_workflow_versions (
  tenant_id uuid not null,
  workflow_id uuid not null,
  version integer not null check (version > 0),
  definition jsonb not null,
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  primary key (workflow_id, version),
  foreign key (tenant_id, workflow_id) references public.automation_workflows (tenant_id, id) on delete cascade
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workflow_id uuid not null,
  workflow_version integer not null,
  trigger_key text not null check (char_length(trigger_key) between 1 and 300),
  trigger_event jsonb not null,
  entity_type text,
  entity_id uuid,
  status text not null default 'pending' check (status in ('pending', 'running', 'waiting', 'completed', 'failed', 'canceled', 'skipped')),
  depth integer not null default 0 check (depth between 0 and 10),
  parent_run_id uuid references public.automation_runs (id) on delete set null,
  current_node_id text,
  steps_executed integer not null default 0 check (steps_executed >= 0),
  context jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workflow_id, trigger_key),
  foreign key (tenant_id, workflow_id) references public.automation_workflows (tenant_id, id) on delete cascade,
  foreign key (workflow_id, workflow_version) references public.automation_workflow_versions (workflow_id, version)
);
create index automation_runs_workflow_idx on public.automation_runs (tenant_id, workflow_id, started_at desc);
create index automation_runs_entity_idx on public.automation_runs (workflow_id, entity_id, started_at desc);
create index automation_runs_status_idx on public.automation_runs (tenant_id, status, started_at desc);

create table public.automation_run_steps (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  run_id uuid not null references public.automation_runs (id) on delete cascade,
  node_id text not null,
  node_type text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped', 'waiting')),
  attempt integer not null default 1,
  input jsonb,
  output jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index automation_run_steps_run_idx on public.automation_run_steps (run_id, id);

select app.enable_tenant_rls('public.ai_action_proposals');
select app.enable_tenant_rls('public.automation_workflows', '{owner,manager}');
select app.enable_tenant_rls('public.automation_workflow_versions', '{owner,manager}');

-- Metering and run history are written by the system context; members read.
alter table public.ai_interactions enable row level security;
grant select on public.ai_interactions to crm_app;
create policy tenant_read on public.ai_interactions for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));

alter table public.automation_runs enable row level security;
grant select on public.automation_runs to crm_app;
create policy tenant_read on public.automation_runs for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));

alter table public.automation_run_steps enable row level security;
grant select on public.automation_run_steps to crm_app;
create policy tenant_read on public.automation_run_steps for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));
