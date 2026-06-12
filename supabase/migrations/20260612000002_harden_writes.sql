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
BEGIN
    target_order := COALESCE(NEW.order_id, OLD.order_id);
    UPDATE orders SET total_estimate = (
        SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = target_order
    ) WHERE id = target_order;
    RETURN NULL;    -- AFTER trigger — אין צורך בערך
END;
$$;

CREATE TRIGGER trg_recompute_order_total
    AFTER INSERT OR UPDATE OR DELETE ON order_items
    FOR EACH ROW EXECUTE FUNCTION public.recompute_order_total();
