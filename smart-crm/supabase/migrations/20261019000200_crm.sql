-- =============================================================================
-- SMART CRM AI — customer management: companies, contacts, custom fields, tags,
-- segments, consent history.
--
-- Cross-row references inside a tenant use composite foreign keys
-- (tenant_id, x_id) → x (tenant_id, id) so rows can never point across tenants.
-- Owner/assignee columns reference memberships (tenant_id, user_id): only a
-- member of the same tenant can own a record, and removing the member clears it.
-- =============================================================================

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  domain text check (char_length(domain) <= 253),
  industry text check (char_length(industry) <= 100),
  size_range text check (size_range in ('1-10', '11-50', '51-200', '201-1000', '1000+')),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 254),
  website text check (char_length(website) <= 300),
  address text check (char_length(address) <= 300),
  city text check (char_length(city) <= 100),
  country text check (char_length(country) <= 2),
  owner_id uuid,
  custom_fields jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz,
  search_text text generated always as (
    lower(coalesce(name, '') || ' ' || coalesce(domain, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, ''))
  ) stored,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, owner_id) references public.memberships (tenant_id, user_id) on delete set null (owner_id)
);
create index companies_tenant_created_idx on public.companies (tenant_id, created_at desc) where deleted_at is null;
create index companies_tenant_name_idx on public.companies (tenant_id, lower(name)) where deleted_at is null;
create index companies_search_idx on public.companies using gin (search_text extensions.gin_trgm_ops);
create index companies_owner_idx on public.companies (tenant_id, owner_id) where deleted_at is null;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid,
  first_name text not null default '' check (char_length(first_name) <= 100),
  last_name text not null default '' check (char_length(last_name) <= 100),
  email text check (char_length(email) <= 254),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  title text check (char_length(title) <= 120),
  source text check (char_length(source) <= 60),
  lifecycle_stage text not null default 'lead'
    check (lifecycle_stage in ('subscriber', 'lead', 'opportunity', 'customer', 'churned', 'other')),
  owner_id uuid,
  whatsapp_consent text not null default 'unknown' check (whatsapp_consent in ('unknown', 'opted_in', 'opted_out')),
  consent_updated_at timestamptz,
  custom_fields jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz,
  search_text text generated always as (
    lower(
      coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
      coalesce(email, '') || ' ' || coalesce(phone, '')
    )
  ) stored,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  check (char_length(first_name) + char_length(last_name) > 0 or email is not null or phone is not null),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete set null (company_id),
  foreign key (tenant_id, owner_id) references public.memberships (tenant_id, user_id) on delete set null (owner_id)
);
create index contacts_tenant_created_idx on public.contacts (tenant_id, created_at desc) where deleted_at is null;
create index contacts_tenant_phone_idx on public.contacts (tenant_id, phone) where deleted_at is null;
create index contacts_tenant_email_idx on public.contacts (tenant_id, lower(email)) where deleted_at is null;
create index contacts_tenant_company_idx on public.contacts (tenant_id, company_id) where deleted_at is null;
create index contacts_owner_idx on public.contacts (tenant_id, owner_id) where deleted_at is null;
create index contacts_search_idx on public.contacts using gin (search_text extensions.gin_trgm_ops);
create index contacts_custom_fields_idx on public.contacts using gin (custom_fields jsonb_path_ops);

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  entity_type text not null check (entity_type in ('contact', 'company', 'deal', 'lead')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(label) between 1 and 80),
  field_type text not null check (field_type in ('text', 'textarea', 'number', 'date', 'boolean', 'select', 'multiselect', 'url', 'email', 'phone')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required boolean not null default false,
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entity_type, key)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index tags_tenant_name_idx on public.tags (tenant_id, lower(name));

create table public.contact_tags (
  tenant_id uuid not null,
  contact_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tag_id) references public.tags (tenant_id, id) on delete cascade
);
create index contact_tags_tag_idx on public.contact_tags (tag_id);

create table public.company_tags (
  tenant_id uuid not null,
  company_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (company_id, tag_id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tag_id) references public.tags (tenant_id, id) on delete cascade
);
create index company_tags_tag_idx on public.company_tags (tag_id);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  entity_type text not null default 'contact' check (entity_type in ('contact')),
  filter jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.contact_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contact_id uuid not null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'email')),
  status text not null check (status in ('opted_in', 'opted_out')),
  source text not null check (source in ('manual', 'import', 'inbound_keyword', 'form', 'api', 'automation')),
  evidence text check (char_length(evidence) <= 1000),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade
);
create index contact_consents_contact_idx on public.contact_consents (tenant_id, contact_id, created_at desc);

select app.enable_tenant_rls('public.companies');
select app.enable_tenant_rls('public.contacts');
select app.enable_tenant_rls('public.custom_field_definitions', '{owner,manager}');
select app.enable_tenant_rls('public.tags');
select app.enable_tenant_rls('public.contact_tags');
select app.enable_tenant_rls('public.company_tags');
select app.enable_tenant_rls('public.segments');
select app.enable_tenant_rls('public.contact_consents');
