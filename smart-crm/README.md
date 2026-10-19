# SMART CRM AI

מערכת CRM רב-ארגונית (SaaS) לעסקים בישראל: אנשי קשר וחברות, לידים ועסקאות עם
Kanban, תיבת WhatsApp Business משותפת (Cloud API הרשמי של Meta בלבד), AI Copilot,
מנוע אוטומציות ויזואלי, משימות ויומן, דוחות, הצעות מחיר עם PDF בעברית, מנויים
וחיוב, קונסולת ניהול פלטפורמה, REST API ו-Webhooks. עברית (RTL) כברירת מחדל,
אנגלית (LTR), מצב בהיר/כהה, מותאם למובייל.

> A multi-tenant CRM SaaS (Next.js 16 + Supabase/Postgres with RLS). Hebrew-first,
> English supported. Everything runs locally with labelled mock providers; real
> integrations need credentials and approvals listed in `docs/PRODUCTION_READINESS.md`.

## התחלה מהירה

```bash
cd smart-crm
npm ci
cp .env.example .env.local      # למלא ENCRYPTION_KEY ו-CRON_SECRET
npm run db:reset && npm run db:seed
npm run dev                      # http://localhost:3000
npm run worker                   # בטרמינל נוסף: משימות רקע
```

משתמשי דמו (סיסמה `Demo!Password1`): `owner@demo.test`, `manager@demo.test`, `agent@demo.test`.

## מסמכים

| מסמך | תוכן |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | התקנה מקומית, סקריפטים, בדיקות |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | ארכיטקטורה, מודל נתונים, אבטחה ובידוד בין ארגונים |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | איך כותבים מודולים, גישה לנתונים, UI ובדיקות |
| [docs/API.md](docs/API.md) · [docs/openapi.json](docs/openapi.json) | REST API v1 ו-Webhooks יוצאים |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | פריסה ל-Vercel + Supabase + worker, ושילובים חיצוניים |
| [docs/SECURITY.md](docs/SECURITY.md) | צ'קליסט אבטחה ומודל איומים |
| [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) | מצב אמיתי, תוצאות בדיקות, מגבלות ואישורים חסרים |

## טכנולוגיות

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript strict · Tailwind CSS v4 ·
Radix UI · next-intl · PostgreSQL 16 / Supabase (Auth, Storage, Realtime) · Drizzle ORM ·
תור משימות עמיד ב-Postgres · OpenAI · Meta WhatsApp Cloud API · Stripe · Zod ·
Vitest · Playwright · GitHub Actions.
