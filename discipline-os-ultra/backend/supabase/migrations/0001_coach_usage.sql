-- DISCIPLINE OS ULTRA — AI coach usage / quota table.
-- Reference migration. NOT applied anywhere by the project authors; a human applies it to their own
-- Supabase project (see backend/README.md).
--
-- Model:
--   * One row per (user, UTC day). The Edge Function (service role) is the ONLY writer, through
--     consume_coach_quota(), which atomically enforces the daily quota and a short burst limit.
--   * RLS: an authenticated user may SELECT only their own rows (e.g. to show "x/30 today").
--     No INSERT/UPDATE/DELETE policy exists, so clients cannot reset their own counters.
--   * No message content is ever stored here — only counters and timestamps.

create table if not exists public.coach_usage (
    user_id            uuid        not null references auth.users (id) on delete cascade,
    usage_date         date        not null,
    request_count      integer     not null default 0 check (request_count >= 0),
    burst_window_start timestamptz not null default now(),
    burst_count        integer     not null default 0 check (burst_count >= 0),
    updated_at         timestamptz not null default now(),
    primary key (user_id, usage_date)
);

comment on table public.coach_usage is
    'Per-user daily AI coach request counters. Counters only; never message content.';

alter table public.coach_usage enable row level security;

drop policy if exists coach_usage_select_own on public.coach_usage;
create policy coach_usage_select_own
    on public.coach_usage
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

-- Defence in depth: even without policies, make the intent explicit.
revoke insert, update, delete, truncate on public.coach_usage from anon, authenticated;
grant select on public.coach_usage to authenticated;

-- Atomically consume one request for p_user_id.
-- Returns 'ok' | 'quota' (daily limit reached → HTTP 402) | 'burst' (too many in window → HTTP 429).
-- A rejected request does not increment the counters.
create or replace function public.consume_coach_quota(
    p_user_id              uuid,
    p_daily_limit          integer,
    p_burst_limit          integer,
    p_burst_window_seconds integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_today date := (now() at time zone 'utc')::date;
    v_row   public.coach_usage%rowtype;
begin
    if p_user_id is null or p_daily_limit < 1 or p_burst_limit < 1 or p_burst_window_seconds < 1 then
        raise exception 'invalid quota arguments';
    end if;

    insert into public.coach_usage (user_id, usage_date)
    values (p_user_id, v_today)
    on conflict (user_id, usage_date) do nothing;

    select * into v_row
    from public.coach_usage
    where user_id = p_user_id and usage_date = v_today
    for update;

    if v_row.request_count >= p_daily_limit then
        return 'quota';
    end if;

    if v_row.burst_window_start > now() - make_interval(secs => p_burst_window_seconds) then
        if v_row.burst_count >= p_burst_limit then
            return 'burst';
        end if;
        update public.coach_usage
           set request_count = request_count + 1,
               burst_count   = burst_count + 1,
               updated_at    = now()
         where user_id = p_user_id and usage_date = v_today;
    else
        update public.coach_usage
           set request_count      = request_count + 1,
               burst_window_start = now(),
               burst_count        = 1,
               updated_at         = now()
         where user_id = p_user_id and usage_date = v_today;
    end if;

    return 'ok';
end;
$$;

-- Only the service role (used inside the Edge Function) may call it.
revoke all on function public.consume_coach_quota(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_coach_quota(uuid, integer, integer, integer) to service_role;

-- Optional housekeeping (run by a human / pg_cron if desired): keep 35 days of counters.
-- delete from public.coach_usage where usage_date < (now() at time zone 'utc')::date - 35;
