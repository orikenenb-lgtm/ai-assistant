-- =============================================================================
-- SMART CRM AI — integration: customer quote decisions get their own
-- notification preference (in-app / email), like the other event types.
-- =============================================================================

alter table public.notification_preferences drop constraint notification_preferences_event_type_check;
alter table public.notification_preferences add constraint notification_preferences_event_type_check check (event_type in (
  'conversation_assigned', 'message_received', 'task_assigned', 'task_reminder',
  'deal_won', 'deal_lost', 'lead_assigned', 'mention', 'ai_proposal', 'automation_failed', 'invitation_accepted',
  'quote_decision'
));
