-- ============================================================================
-- בדיקות RLS (A4 + A6) — מדמה שני לקוחות ואדמין ובודק בידוד נתונים.
-- רץ מקומית על PostgreSQL עם auth_stub.sql. נכשל = העסקה נזרקת עם שגיאה.
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

-- ----- הכנת נתוני בדיקה (כ-superuser, עוקף RLS) -----
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('00000000-0000-0000-0000-00000000000a', 'admin@test.il', '{"full_name": "אבא אדמין"}'),
    ('00000000-0000-0000-0000-000000000001', 'cust1@test.il', '{"full_name": "לקוח אחד"}'),
    ('00000000-0000-0000-0000-000000000002', 'cust2@test.il', '{"full_name": "לקוח שניים"}');

-- ה-trigger יצר profiles אוטומטית; מקדמים את האדמין ומקשרים לקוחות ל-Rivhit
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-00000000000a';
UPDATE profiles SET rivhit_customer_id = 101 WHERE id = '00000000-0000-0000-0000-000000000001';
UPDATE profiles SET rivhit_customer_id = 102 WHERE id = '00000000-0000-0000-0000-000000000002';

INSERT INTO customers (id, rivhit_id, name) VALUES
    ('10000000-0000-0000-0000-000000000001', 101, 'חנות צעצועים חיפה'),
    ('10000000-0000-0000-0000-000000000002', 102, 'צעצוע לי באר שבע');

INSERT INTO products (id, rivhit_id, sku, name, base_price, is_active) VALUES
    ('20000000-0000-0000-0000-000000000001', 1001, 'SKU-1', 'דובי ענק', 99.90, true),
    ('20000000-0000-0000-0000-000000000002', 1002, 'SKU-2', 'מוצר מוסתר', 10.00, false);

INSERT INTO orders (id, customer_id, created_by, status) VALUES
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
     '00000000-0000-0000-0000-000000000001', 'pending'),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
     '00000000-0000-0000-0000-000000000002', 'pending');

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
    ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 5, 99.90),
    ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 3, 99.90);

-- ----- פונקציית עזר לבדיקות -----
CREATE OR REPLACE FUNCTION pg_temp.assert_eq(actual BIGINT, expected BIGINT, test_name TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF actual IS DISTINCT FROM expected THEN
        RAISE EXCEPTION '❌ נכשל: % — צפוי % אבל התקבל %', test_name, expected, actual;
    END IF;
    RAISE NOTICE '✅ עבר: %', test_name;
END;
$$;

-- ============================================================================
-- בדיקות כ"לקוח 1" (RLS פעיל דרך role authenticated)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL app.current_user_id = '00000000-0000-0000-0000-000000000001';

SELECT pg_temp.assert_eq((SELECT count(*) FROM profiles), 1,
    'A6: לקוח רואה רק את הפרופיל של עצמו');
SELECT pg_temp.assert_eq((SELECT count(*) FROM customers), 1,
    'A6: לקוח רואה רק את הלקוח המקושר אליו');
SELECT pg_temp.assert_eq((SELECT count(*) FROM orders), 1,
    'A4: לקוח רואה רק את ההזמנות שלו');
SELECT pg_temp.assert_eq((SELECT count(*) FROM orders WHERE id = '30000000-0000-0000-0000-000000000002'), 0,
    'A4: הזמנה של לקוח אחר — בלתי נראית');
SELECT pg_temp.assert_eq((SELECT count(*) FROM order_items), 1,
    'A4: שורות הזמנה של אחרים — בלתי נראות');
SELECT pg_temp.assert_eq((SELECT count(*) FROM products), 1,
    'O7: מוצר לא פעיל מוסתר מלקוח');
SELECT pg_temp.assert_eq((SELECT count(*) FROM sync_logs), 0,
    'A6: לקוח לא רואה לוגי סנכרון');

-- לקוח מנסה ליצור הזמנה על שם לקוח אחר — חייב להיחסם
DO $$
BEGIN
    BEGIN
        INSERT INTO orders (customer_id, created_by)
        VALUES ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
        RAISE EXCEPTION '❌ נכשל: לקוח הצליח ליצור הזמנה על שם לקוח אחר!';
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        RAISE NOTICE '✅ עבר: יצירת הזמנה על שם לקוח אחר נחסמה';
    END;
END;
$$;

-- לקוח מנסה לערוך סטטוס הזמנה — RLS מתעלם (0 שורות מעודכנות)
UPDATE orders SET status = 'closed' WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_eq(
    (SELECT count(*) FROM orders WHERE status = 'closed'), 0,
    'הרשאות: לקוח לא יכול לערוך הזמנה (גם שלו)');

-- לקוח מנסה לקדם את עצמו ל-admin — ה-trigger חייב לחסום
DO $$
BEGIN
    BEGIN
        UPDATE profiles SET role = 'admin' WHERE id = auth.uid();
        RAISE EXCEPTION '❌ נכשל: לקוח הצליח לקדם את עצמו ל-admin!';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%נכשל%' THEN RAISE; END IF;
        RAISE NOTICE '✅ עבר: העלאת הרשאות עצמית נחסמה (trigger)';
    END;
END;
$$;

-- ============================================================================
-- בדיקות כ"אדמין"
-- ============================================================================
SET LOCAL app.current_user_id = '00000000-0000-0000-0000-00000000000a';

SELECT pg_temp.assert_eq((SELECT count(*) FROM orders), 2,
    'admin רואה את כל ההזמנות');
SELECT pg_temp.assert_eq((SELECT count(*) FROM customers), 2,
    'admin רואה את כל הלקוחות');
SELECT pg_temp.assert_eq((SELECT count(*) FROM products), 2,
    'admin רואה גם מוצרים לא פעילים');
SELECT pg_temp.assert_eq((SELECT count(*) FROM profiles), 3,
    'admin רואה את כל הפרופילים');

-- admin מעדכן סטטוס הזמנה — מותר
UPDATE orders SET status = 'reviewed' WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_eq(
    (SELECT count(*) FROM orders WHERE status = 'reviewed'), 1,
    'admin יכול לעדכן סטטוס הזמנה');

-- ============================================================================
-- משתמש לא מחובר (אנונימי) — לא רואה כלום
-- ============================================================================
SET LOCAL app.current_user_id = '';

SELECT pg_temp.assert_eq((SELECT count(*) FROM orders), 0,
    'אנונימי: 0 הזמנות');
SELECT pg_temp.assert_eq((SELECT count(*) FROM customers), 0,
    'אנונימי: 0 לקוחות');

RESET ROLE;
ROLLBACK;  -- ניקוי מלא — הבדיקות לא משאירות נתונים

\echo '🎉 כל בדיקות ה-RLS עברו בהצלחה'
