-- ============================================================================
-- Migration 0004: הקשחת הרשאות — פונקציות trigger לא קריאות ב-RPC
-- (תואם לבדיקת ה-advisor של Supabase). is_admin/my_rivhit_customer_id נשארות
-- כי הן נחוצות ל-RLS policies וחושפות רק מידע על המשתמש עצמו.
-- ============================================================================

-- search_path קבוע גם ל-set_updated_at (סגירת אזהרת function_search_path_mutable)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_customer_order_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_customer_item_price() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_order_total() FROM PUBLIC, anon, authenticated;
