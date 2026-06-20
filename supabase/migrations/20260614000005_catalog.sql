-- ============================================================================
-- קטלוג רווחית (קריאה בלבד) — טבלת cache עצמאית. אדיטיבי לחלוטין.
-- אין FK לטבלאות קיימות. נתונים זורמים מרווחית → אלינו בלבד (חד-כיווני).
-- RLS: צפייה לכל משתמש מחובר; כתיבה רק service role (הסנכרון בבקנד).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.catalog_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rivhit_item_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    price NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
    image_url TEXT,
    category TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (rivhit_item_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_products_category ON public.catalog_products(category);

ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;

-- צפייה: כל משתמש מחובר רואה את הקטלוג. כתיבה: אין policy → רק service role.
DROP POLICY IF EXISTS catalog_products_select ON public.catalog_products;
CREATE POLICY catalog_products_select ON public.catalog_products
    FOR SELECT TO authenticated USING (true);
