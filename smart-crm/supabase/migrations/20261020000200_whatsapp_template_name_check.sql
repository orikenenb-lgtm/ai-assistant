-- =============================================================================
-- Fix: PostgreSQL regular expressions cap repetition counts at 255, so the
-- original `name ~ '^[a-z0-9_]{1,512}$'` check raised "invalid repetition
-- count(s)" on every insert. Same rule, expressed without a large bound.
-- =============================================================================

alter table public.message_templates drop constraint if exists message_templates_name_check;
alter table public.message_templates
  add constraint message_templates_name_check
  check (name ~ '^[a-z0-9_]+$' and char_length(name) <= 512);
