-- ============================================================================
-- Stub מקומי של סכמת auth של Supabase — לבדיקת ה-migration וה-RLS בלבד.
-- בסביבת Supabase אמיתית הסכמה הזו קיימת מראש — אין להריץ שם את הקובץ הזה!
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

-- טבלת המשתמשים של Supabase (מינימום הנדרש ל-trigger וה-FK)
CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- auth.uid() — בסביבה אמיתית נשלף מה-JWT; כאן ממשתנה session לצורך סימולציה
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- ה-role של Supabase עבור משתמשים מחוברים
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
END
$$;

-- ב-Supabase ה-role authenticated מקבל הרשאות בסיס על public אוטומטית —
-- משחזרים זאת כאן כדי שהבדיקות יבחנו את ה-RLS עצמו ולא חוסר GRANT
GRANT USAGE ON SCHEMA public, auth TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
