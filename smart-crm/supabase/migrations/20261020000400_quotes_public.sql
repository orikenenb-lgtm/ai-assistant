-- =============================================================================
-- SMART CRM AI — quotes: quote-level discount, public share link, view tracking,
-- customer decision signature, and a gapless per-tenant counter usable inside
-- the caller's own transaction.
-- =============================================================================

alter table public.quotes
  add column discount_bp integer not null default 0 check (discount_bp between 0 and 10000),
  -- SHA-256 of the random token in the customer-facing /q/<token> link (token itself is never stored).
  add column public_token_hash text unique check (public_token_hash ~ '^[0-9a-f]{64}$'),
  add column view_count integer not null default 0 check (view_count >= 0),
  add column last_viewed_at timestamptz,
  add column decided_by_name text check (char_length(decided_by_name) <= 120);

create index quotes_status_valid_until_idx on public.quotes (valid_until) where status in ('sent', 'viewed');

-- Gapless sequence per (tenant, key). The upsert row-locks the counter until the
-- caller's transaction ends, so a rolled-back document never consumes a number.
-- crm_app callers must be able to write to the tenant; the system context
-- (no SET ROLE) is always allowed.
create or replace function app.next_tenant_counter(p_tenant_id uuid, p_key text) returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_value bigint;
begin
  if coalesce(nullif(current_setting('role', true), ''), 'none') <> 'none'
     and not exists (select 1 from app.writable_tenant_ids() t where t = p_tenant_id) then
    raise exception 'tenant counter not writable for %', p_tenant_id using errcode = '42501';
  end if;
  insert into public.tenant_counters (tenant_id, key, value)
  values (p_tenant_id, p_key, 1)
  on conflict (tenant_id, key) do update set value = public.tenant_counters.value + 1
  returning value into v_value;
  return v_value;
end
$$;
revoke all on function app.next_tenant_counter(uuid, text) from public;
grant execute on function app.next_tenant_counter(uuid, text) to crm_app;
