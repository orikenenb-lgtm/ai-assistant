-- ============================================================================
-- שכבת CRM — טבלאות חדשות בלבד (prefix crm_), אדיטיבי לחלוטין.
-- אין ALTER/DROP על טבלאות קיימות. אין FK לטבלאות הקיימות (קישור דרך order_ref טקסט).
-- RLS: אדמין בלבד (הגנת עומק; הבקנד ניגש ב-service role אחרי require_admin).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#5b5bd6',
    icon TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.crm_customers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category_id UUID REFERENCES public.crm_categories(id) ON DELETE SET NULL,
    fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_reps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.crm_customers(id) ON DELETE SET NULL,
    category_id UUID REFERENCES public.crm_categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    channel TEXT,
    reason TEXT,
    order_ref TEXT,                       -- קישור רך להזמנות הקיימות (טקסט בלבד)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES public.crm_deals(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    profit NUMERIC(12,2) NOT NULL DEFAULT 0,
    sold_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payment_method TEXT,
    channel TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.crm_customers(id) ON DELETE SET NULL,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'new',   -- new | working | won | lost
    rep_id UUID REFERENCES public.crm_reps(id) ON DELETE SET NULL,
    lost_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.crm_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES public.crm_deals(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.crm_customers(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    due_date DATE,
    paid_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | partial | paid | overdue
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- אינדקסים
CREATE INDEX IF NOT EXISTS idx_crm_contacts_customer ON public.crm_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_customer ON public.crm_deals(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_category ON public.crm_deals(category_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_deal ON public.crm_sales(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_sold_at ON public.crm_sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_crm_leads_rep ON public.crm_leads(rep_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON public.crm_leads(status);
CREATE INDEX IF NOT EXISTS idx_crm_invoices_deal ON public.crm_invoices(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_invoices_status ON public.crm_invoices(status);

-- RLS — אדמין בלבד (is_admin() כבר קיים מהמערכת הקיימת)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_categories','crm_customers','crm_contacts','crm_templates',
                           'crm_reps','crm_deals','crm_sales','crm_leads','crm_invoices']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());',
      t||'_admin_all', t);
  END LOOP;
END $$;
