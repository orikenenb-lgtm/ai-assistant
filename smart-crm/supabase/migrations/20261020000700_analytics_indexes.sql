-- =============================================================================
-- SMART CRM AI — indexes for analytics/dashboard aggregates (date-range scans).
-- =============================================================================

create index deals_won_at_idx on public.deals (tenant_id, won_at) where status = 'won' and deleted_at is null;
create index deals_lost_at_idx on public.deals (tenant_id, lost_at) where status = 'lost' and deleted_at is null;
create index deals_created_idx on public.deals (tenant_id, created_at) where deleted_at is null;
create index deals_open_close_idx on public.deals (tenant_id, expected_close_date) where status = 'open' and deleted_at is null;
create index leads_created_idx on public.leads (tenant_id, created_at) where deleted_at is null;
create index leads_converted_idx on public.leads (tenant_id, converted_at) where converted_at is not null and deleted_at is null;
create index tasks_completed_idx on public.tasks (tenant_id, completed_at) where status = 'done';
create index messages_tenant_created_idx on public.messages (tenant_id, created_at);
