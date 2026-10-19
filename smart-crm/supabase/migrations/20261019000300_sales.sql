-- =============================================================================
-- SMART CRM AI — sales: pipelines, stages, lost reasons, leads, deals, history.
-- =============================================================================

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  is_default boolean not null default false,
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index pipelines_one_default_idx on public.pipelines (tenant_id) where is_default and archived_at is null;

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pipeline_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null default 0,
  probability integer not null default 0 check (probability between 0 and 100),
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (pipeline_id, id),
  foreign key (tenant_id, pipeline_id) references public.pipelines (tenant_id, id) on delete cascade
);
create index pipeline_stages_pipeline_idx on public.pipeline_stages (pipeline_id, position);

create table public.lost_reasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index lost_reasons_label_idx on public.lost_reasons (tenant_id, lower(label));

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 200),
  email text check (char_length(email) <= 254),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  company_name text check (char_length(company_name) <= 200),
  source text not null default 'manual'
    check (source in ('manual', 'website', 'whatsapp', 'referral', 'import', 'api', 'campaign', 'event', 'other')),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'unqualified', 'converted')),
  score integer check (score between 0 and 100),
  ai_classification text check (ai_classification in ('hot', 'warm', 'cold', 'spam')),
  ai_classification_reason text check (char_length(ai_classification_reason) <= 1000),
  ai_classified_at timestamptz,
  estimated_value_cents bigint check (estimated_value_cents >= 0),
  message text check (char_length(message) <= 5000),
  owner_id uuid,
  contact_id uuid,
  converted_deal_id uuid,
  converted_at timestamptz,
  unqualified_reason text check (char_length(unqualified_reason) <= 500),
  custom_fields jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  check (char_length(full_name) > 0 or email is not null or phone is not null),
  check ((status = 'converted') = (converted_at is not null)),
  foreign key (tenant_id, owner_id) references public.memberships (tenant_id, user_id) on delete set null (owner_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete set null (contact_id)
);
create index leads_tenant_status_idx on public.leads (tenant_id, status, created_at desc) where deleted_at is null;
create index leads_owner_idx on public.leads (tenant_id, owner_id) where deleted_at is null;

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pipeline_id uuid not null,
  stage_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  value_cents bigint not null default 0 check (value_cents >= 0 and value_cents < 100000000000000),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  probability integer check (probability between 0 and 100),
  expected_close_date date,
  contact_id uuid,
  company_id uuid,
  lead_id uuid,
  owner_id uuid,
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  lost_reason_id uuid,
  lost_note text check (char_length(lost_note) <= 1000),
  won_at timestamptz,
  lost_at timestamptz,
  position double precision not null default 0,
  custom_fields jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  check (status <> 'won' or won_at is not null),
  check (status <> 'lost' or lost_at is not null),
  foreign key (tenant_id, pipeline_id) references public.pipelines (tenant_id, id) on delete restrict,
  foreign key (pipeline_id, stage_id) references public.pipeline_stages (pipeline_id, id) on delete restrict,
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete set null (contact_id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete set null (company_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete set null (lead_id),
  foreign key (tenant_id, owner_id) references public.memberships (tenant_id, user_id) on delete set null (owner_id),
  foreign key (tenant_id, lost_reason_id) references public.lost_reasons (tenant_id, id) on delete set null (lost_reason_id)
);
create index deals_board_idx on public.deals (tenant_id, pipeline_id, stage_id, position) where deleted_at is null;
create index deals_status_idx on public.deals (tenant_id, status, expected_close_date) where deleted_at is null;
create index deals_contact_idx on public.deals (tenant_id, contact_id) where deleted_at is null;
create index deals_company_idx on public.deals (tenant_id, company_id) where deleted_at is null;
create index deals_owner_idx on public.deals (tenant_id, owner_id) where deleted_at is null;
create index deals_title_idx on public.deals using gin (lower(title) extensions.gin_trgm_ops);

alter table public.leads
  add constraint leads_converted_deal_fk foreign key (tenant_id, converted_deal_id)
  references public.deals (tenant_id, id) on delete set null (converted_deal_id);

create table public.deal_stage_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  deal_id uuid not null,
  from_stage_id uuid,
  to_stage_id uuid not null,
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete cascade
);
create index deal_stage_history_deal_idx on public.deal_stage_history (tenant_id, deal_id, changed_at);
create index deal_stage_history_tenant_idx on public.deal_stage_history (tenant_id, changed_at);

create table public.deal_tags (
  tenant_id uuid not null,
  deal_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (deal_id, tag_id),
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tag_id) references public.tags (tenant_id, id) on delete cascade
);
create index deal_tags_tag_idx on public.deal_tags (tag_id);

create table public.lead_tags (
  tenant_id uuid not null,
  lead_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (lead_id, tag_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tag_id) references public.tags (tenant_id, id) on delete cascade
);
create index lead_tags_tag_idx on public.lead_tags (tag_id);

-- Stage/status history is written by the database itself, so it is complete no
-- matter which code path moved the deal.
create or replace function app.track_deal_stage() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_by)
    values (new.tenant_id, new.id, null, new.stage_id, null, new.status, app.current_user_id());
  elsif new.stage_id is distinct from old.stage_id or new.status is distinct from old.status then
    insert into public.deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_by)
    values (new.tenant_id, new.id, old.stage_id, new.stage_id, old.status, new.status, app.current_user_id());
  end if;
  return new;
end
$$;
revoke all on function app.track_deal_stage() from public;
create trigger deals_track_stage
  after insert or update of stage_id, status on public.deals
  for each row execute function app.track_deal_stage();

select app.enable_tenant_rls('public.pipelines', '{owner,manager}');
select app.enable_tenant_rls('public.pipeline_stages', '{owner,manager}');
select app.enable_tenant_rls('public.lost_reasons', '{owner,manager}');
select app.enable_tenant_rls('public.leads');
select app.enable_tenant_rls('public.deals');
select app.enable_tenant_rls('public.deal_tags');
select app.enable_tenant_rls('public.lead_tags');

alter table public.deal_stage_history enable row level security;
grant select on public.deal_stage_history to crm_app;
create policy tenant_read on public.deal_stage_history for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));
