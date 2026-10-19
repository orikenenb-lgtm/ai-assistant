-- =============================================================================
-- SMART CRM AI — documents (quotes), billing & subscriptions, settings &
-- integrations, privacy requests.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Documents. Quotes are commercial offers, NOT tax invoices.
-- -----------------------------------------------------------------------------
create table public.tenant_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key in ('quote')),
  value bigint not null default 0 check (value >= 0),
  primary key (tenant_id, key)
);

create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null default 'quote' check (kind in ('quote')),
  name text not null check (char_length(name) between 1 and 80),
  is_default boolean not null default false,
  header_text text check (char_length(header_text) <= 1000),
  footer_text text check (char_length(footer_text) <= 1000),
  terms text check (char_length(terms) <= 5000),
  accent_color text not null default '#4f46e5' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  show_logo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index document_templates_default_idx on public.document_templates (tenant_id, kind) where is_default;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  number bigint not null check (number > 0),
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'canceled')),
  language text not null default 'he' check (language in ('he', 'en')),
  contact_id uuid,
  company_id uuid,
  deal_id uuid,
  template_id uuid,
  issue_date date not null default current_date,
  valid_until date,
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_rate_bp integer not null default 1800 check (tax_rate_bp between 0 and 10000),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  notes text check (char_length(notes) <= 5000),
  terms text check (char_length(terms) <= 5000),
  pdf_storage_key text,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  decision_note text check (char_length(decision_note) <= 1000),
  external_invoice_provider text,
  external_invoice_id text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  check (valid_until is null or valid_until >= issue_date),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete set null (contact_id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete set null (company_id),
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete set null (deal_id),
  foreign key (tenant_id, template_id) references public.document_templates (tenant_id, id) on delete set null (template_id)
);
create index quotes_tenant_idx on public.quotes (tenant_id, created_at desc);
create index quotes_deal_idx on public.quotes (tenant_id, deal_id) where deal_id is not null;

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  quote_id uuid not null,
  position integer not null default 0,
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_bp integer not null default 0 check (discount_bp between 0 and 10000),
  line_total_cents bigint not null check (line_total_cents >= 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, quote_id) references public.quotes (tenant_id, id) on delete cascade
);
create index quote_items_quote_idx on public.quote_items (quote_id, position);

-- -----------------------------------------------------------------------------
-- Billing & subscriptions
-- -----------------------------------------------------------------------------
create table public.plans (
  id text primary key check (id ~ '^[a-z0-9_]{2,32}$'),
  name_he text not null,
  name_en text not null,
  description_he text not null default '',
  description_en text not null default '',
  price_monthly_cents integer not null check (price_monthly_cents >= 0),
  price_yearly_cents integer not null check (price_yearly_cents >= 0),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  trial_days integer not null default 0 check (trial_days between 0 and 90),
  seat_limit integer check (seat_limit > 0),
  limits jsonb not null default '{}'::jsonb,
  features text[] not null default '{}',
  provider_price_ids jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'paused')),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  seats integer not null default 1 check (seats > 0),
  provider text not null default 'mock' check (provider in ('mock', 'stripe')),
  provider_customer_id text,
  provider_subscription_id text unique,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_plan_overrides (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  limits jsonb not null default '{}'::jsonb,
  features_add text[] not null default '{}',
  features_remove text[] not null default '{}',
  note text check (char_length(note) <= 500),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.usage_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  metric text not null check (metric in ('ai_tokens', 'ai_cost_micros', 'whatsapp_messages', 'automation_runs', 'storage_bytes', 'api_calls', 'contacts_imported')),
  quantity bigint not null check (quantity >= 0),
  occurred_at timestamptz not null default now(),
  ref_type text,
  ref_id text,
  idempotency_key text unique
);
create index usage_events_tenant_idx on public.usage_events (tenant_id, metric, occurred_at);

-- -----------------------------------------------------------------------------
-- Settings & integrations
-- -----------------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  prefix text not null check (prefix ~ '^sck_[a-z0-9]{8}$'),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (cardinality(scopes) > 0),
  created_by uuid references public.profiles (id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_keys_tenant_idx on public.api_keys (tenant_id, created_at desc);

create table public.outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  description text check (char_length(description) <= 200),
  events text[] not null check (cardinality(events) > 0),
  secret_id uuid references public.secrets (id) on delete set null,
  active boolean not null default true,
  consecutive_failures integer not null default 0,
  disabled_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.outbound_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  webhook_id uuid not null,
  event_type text not null,
  event_id uuid not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0,
  response_status integer,
  response_excerpt text,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (webhook_id, event_id),
  foreign key (tenant_id, webhook_id) references public.outbound_webhooks (tenant_id, id) on delete cascade
);
create index outbound_deliveries_idx on public.outbound_webhook_deliveries (tenant_id, webhook_id, created_at desc);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'microsoft_calendar', 'greeninvoice', 'icount', 'rivhit', 'resend', 'stripe', 'openai')),
  status text not null default 'disconnected' check (status in ('disconnected', 'pending', 'connected', 'error')),
  config jsonb not null default '{}'::jsonb,
  secret_id uuid references public.secrets (id) on delete set null,
  connected_by uuid references public.profiles (id) on delete set null,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null check (type in ('export', 'delete')),
  subject_type text not null check (subject_type in ('contact', 'tenant')),
  subject_id uuid,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'canceled')),
  requested_by uuid references public.profiles (id) on delete set null,
  file_storage_key text,
  error text,
  scheduled_for timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index data_requests_tenant_idx on public.data_requests (tenant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
select app.enable_tenant_rls('public.document_templates', '{owner,manager}');
select app.enable_tenant_rls('public.quotes');
select app.enable_tenant_rls('public.quote_items');
select app.enable_tenant_rls('public.api_keys', '{owner}');
select app.enable_tenant_rls('public.outbound_webhooks', '{owner,manager}');
select app.enable_tenant_rls('public.integration_connections', '{owner,manager}');
select app.enable_tenant_rls('public.data_requests', '{owner}');

alter table public.tenant_counters enable row level security; -- system only (numbering)

alter table public.plans enable row level security;
grant select on public.plans to crm_app;
create policy plans_read on public.plans for select to crm_app using (active);

alter table public.subscriptions enable row level security;
grant select on public.subscriptions to crm_app;
create policy tenant_read on public.subscriptions for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));

alter table public.tenant_plan_overrides enable row level security;
grant select on public.tenant_plan_overrides to crm_app;
create policy tenant_read on public.tenant_plan_overrides for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));

alter table public.usage_events enable row level security;
grant select on public.usage_events to crm_app;
create policy tenant_read on public.usage_events for select to crm_app
  using (tenant_id in (select app.readable_tenant_ids()));

alter table public.outbound_webhook_deliveries enable row level security;
grant select on public.outbound_webhook_deliveries to crm_app;
create policy tenant_read on public.outbound_webhook_deliveries for select to crm_app
  using (app.has_tenant_role(tenant_id, '{owner,manager}'));

-- -----------------------------------------------------------------------------
-- Seed: subscription plans (prices in agorot, ILS). Feature keys are checked by
-- src/modules/billing/entitlements.ts.
-- -----------------------------------------------------------------------------
insert into public.plans (id, name_he, name_en, description_he, description_en, price_monthly_cents, price_yearly_cents, trial_days, seat_limit, limits, features, sort)
values
  ('free', 'חינם', 'Free', 'להתחלה ולצוותים קטנים', 'Get started with a small team', 0, 0, 0, 2,
   '{"max_contacts": 500, "ai_tokens_monthly": 20000, "whatsapp_messages_monthly": 0, "max_workflows": 1, "storage_mb": 200}',
   '{crm,tasks,documents}', 10),
  ('starter', 'סטארטר', 'Starter', 'CRM מלא עם WhatsApp', 'Full CRM with WhatsApp', 14900, 149000, 14, 5,
   '{"max_contacts": 5000, "ai_tokens_monthly": 300000, "whatsapp_messages_monthly": 2000, "max_workflows": 5, "storage_mb": 2000}',
   '{crm,tasks,documents,whatsapp,ai,automation,analytics}', 20),
  ('pro', 'פרו', 'Pro', 'לצוותי מכירות בצמיחה', 'For growing sales teams', 39900, 399000, 14, 20,
   '{"max_contacts": 50000, "ai_tokens_monthly": 2000000, "whatsapp_messages_monthly": 20000, "max_workflows": 50, "storage_mb": 20000}',
   '{crm,tasks,documents,whatsapp,ai,automation,analytics,api,custom_fields,webhooks}', 30),
  ('business', 'ביזנס', 'Business', 'לארגונים עם דרישות מתקדמות', 'Advanced needs at scale', 99900, 999000, 14, null,
   '{"max_contacts": 500000, "ai_tokens_monthly": 10000000, "whatsapp_messages_monthly": 200000, "max_workflows": 500, "storage_mb": 200000}',
   '{crm,tasks,documents,whatsapp,ai,automation,analytics,api,custom_fields,webhooks,audit_export,priority_support}', 40);

insert into public.feature_flags (key, description, enabled) values
  ('ai.copilot', 'AI copilot features', true),
  ('whatsapp.inbox', 'WhatsApp inbox', true),
  ('automation.engine', 'Automation workflows', true),
  ('documents.pdf', 'Quote PDF generation', true),
  ('calendar.sync', 'External calendar sync (architecture only)', false);
