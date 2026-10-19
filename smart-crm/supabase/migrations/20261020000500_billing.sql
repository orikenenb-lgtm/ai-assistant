-- =============================================================================
-- SMART CRM AI — billing lifecycle columns and admin lookups.
-- =============================================================================

-- When a subscription entered past_due (start of the dunning grace period).
alter table public.subscriptions add column past_due_since timestamptz;

create index subscriptions_lifecycle_idx on public.subscriptions (status, trial_ends_at);
create index subscriptions_customer_idx on public.subscriptions (provider, provider_customer_id) where provider_customer_id is not null;

-- Support sessions are listed per tenant in the admin console.
create index support_sessions_tenant_idx on public.support_sessions (tenant_id, started_at desc);
