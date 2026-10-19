-- =============================================================================
-- SMART CRM AI — WhatsApp Business inbox (official Meta Cloud API only).
-- =============================================================================

create table public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null default 'meta' check (provider in ('meta', 'mock')),
  display_name text not null check (char_length(display_name) between 1 and 100),
  phone_number text not null check (phone_number ~ '^\+[1-9][0-9]{6,14}$'),
  -- Meta's phone number id is globally unique: it routes inbound webhooks to a tenant.
  phone_number_id text not null unique check (phone_number_id ~ '^[A-Za-z0-9_-]{3,64}$'),
  waba_id text not null check (waba_id ~ '^[A-Za-z0-9_-]{3,64}$'),
  access_token_secret_id uuid references public.secrets (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'disabled', 'error')),
  quality_rating text,
  messaging_limit text,
  send_rate_per_minute integer not null default 60 check (send_rate_per_minute between 1 and 1000),
  last_error text,
  last_synced_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  whatsapp_account_id uuid not null,
  contact_id uuid not null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  status text not null default 'open' check (status in ('open', 'pending', 'closed')),
  assignee_id uuid,
  handoff_state text not null default 'human' check (handoff_state in ('bot', 'human')),
  needs_attention boolean not null default false,
  last_message_at timestamptz,
  last_message_preview text check (char_length(last_message_preview) <= 200),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (whatsapp_account_id, contact_id),
  foreign key (tenant_id, whatsapp_account_id) references public.whatsapp_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, assignee_id) references public.memberships (tenant_id, user_id) on delete set null (assignee_id)
);
create index conversations_inbox_idx on public.conversations (tenant_id, status, last_message_at desc nulls last);
create index conversations_assignee_idx on public.conversations (tenant_id, assignee_id, status);
create index conversations_contact_idx on public.conversations (tenant_id, contact_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  conversation_id uuid not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  type text not null check (type in ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts', 'template', 'interactive', 'reaction', 'button', 'unsupported')),
  body text check (char_length(body) <= 4096),
  media jsonb,
  template jsonb,
  wa_message_id text,
  status text not null check (status in ('received', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed')),
  error_code text,
  error_message text,
  sender_type text not null check (sender_type in ('contact', 'user', 'ai', 'automation', 'system')),
  sender_user_id uuid references public.profiles (id) on delete set null,
  client_key text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check ((direction = 'inbound') = (status = 'received')),
  foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id) on delete cascade
);
create unique index messages_wa_id_idx on public.messages (wa_message_id) where wa_message_id is not null;
create unique index messages_client_key_idx on public.messages (tenant_id, client_key) where client_key is not null;
create index messages_conversation_idx on public.messages (tenant_id, conversation_id, created_at);
create index messages_outbound_status_idx on public.messages (tenant_id, status, created_at) where direction = 'outbound';

create table public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  conversation_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id) on delete cascade
);
create index conversation_notes_idx on public.conversation_notes (tenant_id, conversation_id, created_at);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  whatsapp_account_id uuid not null,
  name text not null check (name ~ '^[a-z0-9_]{1,512}$'),
  language text not null check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  category text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  status text not null check (status in ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL')),
  components jsonb not null default '[]'::jsonb check (jsonb_typeof(components) = 'array'),
  meta_template_id text,
  rejected_reason text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (whatsapp_account_id, name, language),
  foreign key (tenant_id, whatsapp_account_id) references public.whatsapp_accounts (tenant_id, id) on delete cascade
);

select app.enable_tenant_rls('public.whatsapp_accounts', '{owner,manager}');
select app.enable_tenant_rls('public.conversations');
select app.enable_tenant_rls('public.messages');
select app.enable_tenant_rls('public.conversation_notes');
select app.enable_tenant_rls('public.message_templates', '{owner,manager}');

-- Browser realtime (Supabase Realtime evaluates RLS as `authenticated`).
grant select on public.conversations, public.messages to authenticated;
create policy realtime_read on public.conversations for select to authenticated
  using (tenant_id in (select app.readable_tenant_ids()));
create policy realtime_read on public.messages for select to authenticated
  using (tenant_id in (select app.readable_tenant_ids()));
