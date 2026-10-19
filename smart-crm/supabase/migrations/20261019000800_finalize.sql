-- =============================================================================
-- SMART CRM AI — cross-cutting finishing touches.
-- =============================================================================

-- updated_at maintenance for every table that has the column.
do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    execute format(
      'create trigger touch_updated_at before update on public.%I for each row execute function app.touch_updated_at()',
      r.table_name
    );
  end loop;
end
$$;

grant usage on all sequences in schema public to crm_app;

-- Nothing in public is reachable by anon; authenticated keeps only the explicit
-- realtime SELECT grants made in earlier migrations.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema app from anon;
grant select on public.conversations, public.messages, public.notifications to authenticated;

-- Supabase-only wiring (skipped automatically on plain PostgreSQL).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.conversations, public.notifications;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('crm-files', 'crm-files', false, 26214400)
    on conflict (id) do nothing;
  end if;
end
$$;
