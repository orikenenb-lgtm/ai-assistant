-- ============================================================================
-- Kerem Orders — הקמת מסד הנתונים המלאה בהדבקה אחת
-- ----------------------------------------------------------------------------
-- איך משתמשים:
--   1. Supabase → פרויקט → SQL Editor → New query
--   2. הדבק את כל הקובץ הזה → Run
--   3. זהו. כל הטבלאות, ה-RLS, ה-triggers וההגנות הוקמו.
--
-- בטוח להרצה חוזרת? הקובץ מיועד להרצה אחת על DB נקי. אם כבר הרצת חלק —
-- מחק את הסכמה (או צור פרויקט חדש) והרץ מאפס.
-- אין להריץ את supabase/tests/ — זה stub לבדיקות מקומיות בלבד.
-- ============================================================================


-- ####################################################################
-- מקור: migrations/20260612000000_init.sql
-- ####################################################################
-- ============================================================================
-- Kerem Orders — Migration ראשוני: טבלאות, אינדקסים, RLS, triggers
-- להרצה ב-Supabase SQL Editor (או דרך supabase db push)
-- ============================================================================

-- ============================================================================
-- 1. טבלאות
-- ============================================================================

-- משתמשים (מרחיב את Supabase Auth)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
    full_name TEXT,
    phone TEXT,
    rivhit_customer_id INTEGER,            -- קישור ללקוח ב-Rivhit
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_approval', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- לקוחות (מסונכרן מ-Rivhit — כתיבה רק דרך service role בסנכרון)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rivhit_id INTEGER UNIQUE NOT NULL,
    name TEXT NOT NULL,
    city TEXT,
    region TEXT,                           -- 'צפון' | 'דרום' | 'מרכז'
    phone TEXT,
    email TEXT UNIQUE,
    price_list_id INTEGER,                 -- מחירון ספציפי
    contact_person TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- מוצרים (מסונכרן מ-Rivhit — כתיבה רק דרך service role בסנכרון)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rivhit_id INTEGER UNIQUE NOT NULL,
    sku TEXT UNIQUE,                       -- מק"ט / ברקוד
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    base_price NUMERIC(10,2) NOT NULL,
    cost_price NUMERIC(10,2),
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    unit TEXT,                             -- יחידת מכירה
    image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- הזמנות
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number SERIAL UNIQUE,            -- מספר ידידותי (1, 2, 3...)
    customer_id UUID NOT NULL REFERENCES customers(id),
    created_by UUID NOT NULL REFERENCES profiles(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'reviewed', 'quoted', 'confirmed', 'shipped', 'closed', 'cancelled')),
    total_estimate NUMERIC(10,2),
    final_total NUMERIC(10,2),
    notes TEXT,                            -- הערות לקוח
    admin_notes TEXT,                      -- הערות פנימיות לאבא
    rivhit_quote_id INTEGER,               -- מזהה הצעה ב-Rivhit
    rivhit_order_id INTEGER,               -- מזהה הזמנה ב-Rivhit
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    quoted_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    shipped_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ
);

-- שורות הזמנה
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL,    -- snapshot מחיר מרגע ההזמנה
    line_total NUMERIC(10,2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- לוג סנכרון (audit trail) — כתיבה רק מהבקנד (service role)
CREATE TABLE sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type TEXT NOT NULL CHECK (sync_type IN ('products', 'customers', 'prices')),
    status TEXT NOT NULL CHECK (status IN ('success', 'error')),
    records_synced INTEGER NOT NULL DEFAULT 0,
    records_updated INTEGER NOT NULL DEFAULT 0,
    records_created INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audit log (מי עשה מה ומתי) — כתיבה רק מהבקנד (service role)
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id),
    action TEXT NOT NULL,                  -- 'created_order' | 'quoted_order' | 'synced' ...
    entity_type TEXT,                      -- 'order' | 'customer' | 'product'
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. אינדקסים לביצועים
-- ============================================================================

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_by ON orders(created_by);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_customers_active ON customers(is_active);
CREATE INDEX idx_sync_logs_type ON sync_logs(sync_type);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_profiles_rivhit_customer ON profiles(rivhit_customer_id);

-- ============================================================================
-- 3. פונקציות עזר
-- ============================================================================

-- בדיקת admin בלי רקורסיה: SECURITY DEFINER עוקף RLS ולכן policy על profiles
-- יכול להשתמש בה בלי להפעיל את עצמו שוב (פתרון לבעיית infinite recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
$$;

-- ה-rivhit_customer_id של המשתמש המחובר (גם כן SECURITY DEFINER, לשימוש ב-policies)
CREATE OR REPLACE FUNCTION public.my_rivhit_customer_id()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT rivhit_customer_id FROM profiles WHERE id = auth.uid();
$$;

-- עדכון אוטומטי של updated_at בכל UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- יצירת profile אוטומטית בהרשמה (trigger על auth.users)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, phone)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'phone'
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- הגנה מפני העלאת הרשאות: משתמש רגיל לא יכול לשנות לעצמו role / status / קישור Rivhit
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() AND auth.uid() IS NOT NULL THEN
        IF NEW.role IS DISTINCT FROM OLD.role
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.rivhit_customer_id IS DISTINCT FROM OLD.rivhit_customer_id THEN
            RAISE EXCEPTION 'אין הרשאה לשנות שדות מוגנים בפרופיל';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_profile_fields BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- ============================================================================
-- 4. הפעלת RLS (חובה! בלי זה ה-policies לא פעילים והטבלאות פתוחות)
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. RLS Policies
--    עיקרון: customer רואה רק את שלו; admin רואה הכל (דרך is_admin());
--    כתיבת sync (customers/products) — רק service role (אין policy = חסום).
-- ============================================================================

-- profiles: כל משתמש רואה את עצמו; admin רואה את כולם
CREATE POLICY "profiles_select" ON profiles
FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_admin());

-- profiles: משתמש מעדכן את עצמו (שדות מוגנים נחסמים ב-trigger); admin את כולם
CREATE POLICY "profiles_update" ON profiles
FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.is_admin())
WITH CHECK (id = auth.uid() OR public.is_admin());

-- customers: לקוח רואה רק את הלקוח המקושר אליו; admin רואה הכל
CREATE POLICY "customers_select" ON customers
FOR SELECT TO authenticated
USING (rivhit_id = public.my_rivhit_customer_id() OR public.is_admin());

-- products: כל משתמש מחובר רואה מוצרים פעילים; admin רואה הכל
CREATE POLICY "products_select" ON products
FOR SELECT TO authenticated
USING (is_active = true OR public.is_admin());

-- orders: לקוח רואה רק הזמנות שיצר; admin רואה הכל
CREATE POLICY "orders_select" ON orders
FOR SELECT TO authenticated
USING (created_by = auth.uid() OR public.is_admin());

-- orders: לקוח יוצר הזמנה רק בשם עצמו ורק עבור הלקוח המקושר אליו
-- (מונע יצירת הזמנה על שם לקוח אחר); admin יוצר לכל לקוח
CREATE POLICY "orders_insert" ON orders
FOR INSERT TO authenticated
WITH CHECK (
    public.is_admin()
    OR (
        created_by = auth.uid()
        AND status = 'pending'
        AND EXISTS (
            SELECT 1 FROM customers c
            WHERE c.id = orders.customer_id
              AND c.rivhit_id = public.my_rivhit_customer_id()
        )
    )
);

-- orders: עריכה — admin בלבד (סטטוס, הערות, תמחור)
CREATE POLICY "orders_update" ON orders
FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- order_items: רואים שורות רק של הזמנה שמותרת לך
CREATE POLICY "order_items_select" ON order_items
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_items.order_id
          AND (o.created_by = auth.uid() OR public.is_admin())
    )
);

-- order_items: לקוח מוסיף שורות רק להזמנה שלו וכל עוד היא pending; admin תמיד
CREATE POLICY "order_items_insert" ON order_items
FOR INSERT TO authenticated
WITH CHECK (
    public.is_admin()
    OR EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_items.order_id
          AND o.created_by = auth.uid()
          AND o.status = 'pending'
    )
);

-- order_items: עריכה/מחיקה — admin בלבד
CREATE POLICY "order_items_update" ON order_items
FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "order_items_delete" ON order_items
FOR DELETE TO authenticated
USING (public.is_admin());

-- sync_logs / audit_log: צפייה — admin בלבד; כתיבה — רק service role מהבקנד
CREATE POLICY "sync_logs_select" ON sync_logs
FOR SELECT TO authenticated
USING (public.is_admin());

CREATE POLICY "audit_log_select" ON audit_log
FOR SELECT TO authenticated
USING (public.is_admin());


-- ####################################################################
-- מקור: migrations/20260612000001_invite_linking.sql
-- ####################################################################
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


-- ####################################################################
-- מקור: migrations/20260612000002_harden_writes.sql
-- ####################################################################
-- ============================================================================
-- Migration 0003: חיזוק כתיבה ישירה ל-DB (הגנת עומק — שכבה 1)
-- ה-API כבר אוכף הכל, אבל עיקרון שתי השכבות דורש שגם גישה ישירה
-- (PostgREST עם JWT של לקוח) לא תוכל לזייף מחירים או שדות בבעלות אדמין.
-- ============================================================================

-- לקוח שמכניס הזמנה ישירות: שדות בבעלות המערכת/אדמין מאופסים בכוח
CREATE OR REPLACE FUNCTION public.enforce_customer_order_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- service role (auth.uid() ריק) ואדמין — ללא הגבלה
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
        NEW.status := 'pending';
        NEW.final_total := NULL;
        NEW.admin_notes := NULL;
        NEW.rivhit_quote_id := NULL;
        NEW.rivhit_order_id := NULL;
        NEW.quoted_at := NULL;
        NEW.confirmed_at := NULL;
        NEW.shipped_at := NULL;
        NEW.closed_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_customer_order_insert
    BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_order_insert();

-- לקוח שמכניס שורת הזמנה: המחיר נכפה מהקטלוג — אי אפשר לזייף snapshot (O8)
CREATE OR REPLACE FUNCTION public.enforce_customer_item_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    product_price NUMERIC(10,2);
    product_active BOOLEAN;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
        SELECT base_price, is_active INTO product_price, product_active
        FROM products WHERE id = NEW.product_id;
        IF NOT FOUND OR NOT product_active THEN
            RAISE EXCEPTION 'המוצר אינו זמין להזמנה';
        END IF;
        NEW.unit_price := product_price;
        NEW.line_total := round(product_price * NEW.quantity, 2);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_customer_item_price
    BEFORE INSERT ON order_items
    FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_item_price();

-- הסכום המשוער של הזמנה תמיד נגזר משורותיה — עקבי גם אם נוסה לזייף אותו
CREATE OR REPLACE FUNCTION public.recompute_order_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_order UUID;
    source_order UUID;
BEGIN
    -- אם אדמין מעביר שורה בין הזמנות — מחשבים מחדש את שתיהן
    target_order := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.order_id END;
    source_order := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.order_id END;
    IF target_order IS NOT NULL THEN
        UPDATE orders SET total_estimate = (
            SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = target_order
        ) WHERE id = target_order;
    END IF;
    IF source_order IS NOT NULL AND source_order IS DISTINCT FROM target_order THEN
        UPDATE orders SET total_estimate = (
            SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = source_order
        ) WHERE id = source_order;
    END IF;
    RETURN NULL;    -- AFTER trigger — אין צורך בערך
END;
$$;

CREATE TRIGGER trg_recompute_order_total
    AFTER INSERT OR UPDATE OR DELETE ON order_items
    FOR EACH ROW EXECUTE FUNCTION public.recompute_order_total();

