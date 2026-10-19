-- =============================================================================
-- SMART CRM AI — security hardening after the internal review.
-- Makes the database (not only the app) enforce the role hierarchy, the job
-- queue's tenant binding and a few tighter per-table rules.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Memberships: role hierarchy enforced in the database.
--    Owners manage everyone; managers manage agents only and can only grant
--    "agent". Tenant and user of a membership never change.
-- -----------------------------------------------------------------------------
revoke update on public.memberships from crm_app;
grant update (role, status) on public.memberships to crm_app;

create or replace function app.guard_membership_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- System context (webhooks, worker, admin) is not restricted here.
  if current_user <> 'crm_app' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and (new.tenant_id <> old.tenant_id or new.user_id <> old.user_id) then
    raise exception 'membership tenant/user cannot change' using errcode = '42501';
  end if;
  if not app.has_tenant_role(old.tenant_id, '{owner}') then
    if old.role <> 'agent' or (tg_op = 'UPDATE' and new.role <> 'agent') then
      raise exception 'only owners can manage owners and managers' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end
$$;
revoke all on function app.guard_membership_change() from public;

create trigger memberships_guard
  before update or delete on public.memberships
  for each row execute function app.guard_membership_change();

-- Invitations: managers may only invite agents.
create policy invitations_role_guard on public.invitations as restrictive for insert to crm_app
  with check (role = 'agent' or app.has_tenant_role(tenant_id, '{owner}'));
create policy invitations_role_guard_update on public.invitations as restrictive for update to crm_app
  using (role = 'agent' or app.has_tenant_role(tenant_id, '{owner}'))
  with check (role = 'agent' or app.has_tenant_role(tenant_id, '{owner}'));

-- -----------------------------------------------------------------------------
-- 2. Job queue: user transactions may only enqueue work for their own tenant,
--    with a payload that agrees on the tenant, and cannot squat the platform
--    scheduler's idempotency keys. (Reads stay tenant-scoped: enqueueing uses
--    INSERT … RETURNING, which needs the new row to pass the SELECT policy.)
-- -----------------------------------------------------------------------------

drop policy jobs_insert on public.jobs;
create policy jobs_insert on public.jobs for insert to crm_app
  with check (
    tenant_id in (select app.writable_tenant_ids())
    and status = 'queued'
    and attempts = 0
    and (idempotency_key is null or idempotency_key not like 'sched:%')
    and (payload->>'tenantId' is null or payload->>'tenantId' = tenant_id::text)
  );

-- -----------------------------------------------------------------------------
-- 3. Tags: everyone may create/attach tags; renaming and deleting is for
--    owners and managers (settings.manage in the app).
-- -----------------------------------------------------------------------------
drop policy tenant_update on public.tags;
drop policy tenant_delete on public.tags;
create policy tenant_update on public.tags for update to crm_app
  using (tenant_id in (select app.writable_tenant_ids()) and app.has_tenant_role(tenant_id, '{owner,manager}'))
  with check (tenant_id in (select app.writable_tenant_ids()) and app.has_tenant_role(tenant_id, '{owner,manager}'));
create policy tenant_delete on public.tags for delete to crm_app
  using (tenant_id in (select app.writable_tenant_ids()) and app.has_tenant_role(tenant_id, '{owner,manager}'));

-- -----------------------------------------------------------------------------
-- 4. AI proposals: created only as "pending" by the requesting user; decided
--    only while pending/approved, and only by the deciding user. Never deleted
--    by app roles (expiry and failures are recorded by the system).
-- -----------------------------------------------------------------------------
drop policy tenant_insert on public.ai_action_proposals;
drop policy tenant_update on public.ai_action_proposals;
drop policy tenant_delete on public.ai_action_proposals;
revoke delete on public.ai_action_proposals from crm_app;
create policy tenant_insert on public.ai_action_proposals for insert to crm_app
  with check (
    tenant_id in (select app.writable_tenant_ids())
    and status = 'pending'
    and requested_by = (select app.current_user_id())
    and decided_by is null and executed_at is null
  );
create policy tenant_update on public.ai_action_proposals for update to crm_app
  using (tenant_id in (select app.writable_tenant_ids()) and status in ('pending', 'approved'))
  with check (
    tenant_id in (select app.writable_tenant_ids())
    and decided_by = (select app.current_user_id())
    and status in ('approved', 'rejected', 'executed')
  );

-- -----------------------------------------------------------------------------
-- 5. Realtime notifications: only for organizations the user can still read
--    (a removed member no longer sees that organization's notifications).
-- -----------------------------------------------------------------------------
drop policy realtime_read on public.notifications;
create policy realtime_read on public.notifications for select to authenticated
  using (user_id = (select app.current_user_id()) and tenant_id in (select app.readable_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 6. Functions created from now on are not executable by PUBLIC by default
--    (per-schema default privileges cannot revoke PUBLIC EXECUTE; this can).
-- -----------------------------------------------------------------------------
alter default privileges revoke execute on functions from public;
