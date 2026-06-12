-- ============================================================================
-- Migration 0002: קישור אוטומטי בהזמנת לקוח (invite)
-- כשאדמין מזמין לקוח עם rivhit_customer_id ב-metadata — הפרופיל נוצר מקושר.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, phone, rivhit_customer_id)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'phone',
        -- מגיע רק מהזמנת אדמין (invite) — משתמש רגיל לא שולט ב-metadata הזה אצלנו
        NULLIF(NEW.raw_user_meta_data->>'rivhit_customer_id', '')::integer
    );
    RETURN NEW;
END;
$$;
