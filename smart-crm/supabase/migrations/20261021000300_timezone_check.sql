-- =============================================================================
-- SMART CRM AI — organizations must have a valid IANA time zone. Scheduled jobs
-- convert times per tenant; one invalid zone used to break them for everyone.
-- =============================================================================

create or replace function app.check_tenant_timezone() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when invalid_parameter_value then
  raise exception 'invalid time zone: %', new.timezone using errcode = '23514';
end
$$;
revoke all on function app.check_tenant_timezone() from public;

create trigger tenants_timezone_check
  before insert or update of timezone on public.tenants
  for each row execute function app.check_tenant_timezone();
