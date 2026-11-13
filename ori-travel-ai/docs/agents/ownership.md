# בעלות על קבצים (מונעת כתיבות חופפות)

כל סוכן כותב **רק** בתחום שלו. שינוי מחוץ לתחום מתבקש בדוח, והמנהל מבצע אותו או מנתב אותו
לבעלים. המנהל הוא בעלים ברירת מחדל של כל מה שלא מופיע כאן.

## Backend (`apps/api`)
| נתיב | בעלים (V3) | בעלים (V6) |
|---|---|---|
| `app/core/**`, `app/main.py`, `app/cli.py`, `app/models/__init__.py`, `tests/conftest.py`, `alembic/**` | מנהל | מנהל |
| `app/schemas/**` | מנהל | מנהל + BE-CAL (`search.py`, תוספות בלבד) |
| `app/modules/auth/**`, `health/**` | מנהל | מנהל |
| `family/`, `travelers/`, `notifications/`, `audit/`, `settings/`, `seed.py`, `models/family.py` | B1 | — (יציב) |
| `providers/**`, `search/**`, `comparison/**` | B2, ואחר כך B6 (`providers/live`, `fx.py`) | BE-CAL (`search`, `providers/demo/flights`, geo). BOOK-REDIRECT (`providers/demo/activities`) |
| `itineraries/`, `saved/`, `price_tracking/` | B3 | BE-TRIPS (`itineraries`) |
| `booking/**`, `models/booking.py` | B4 | BOOK-REDIRECT |
| `ai/**` | B5 | — (יציב) |

## Web (`apps/web`)
| נתיב | V3 | V6 |
|---|---|---|
| `src/styles/**`, `src/components/ui/**`, `src/components/layout/**` | F1 | UX-DS (ה-tokens החדשים הוגדרו ע״י המנהל כחוזה) |
| `src/lib/api.ts`, `queryClient`, `features/auth`, `router.tsx` | F1 | מנהל (BOOK-REDIRECT מורשה להוסיף נתיב אחד) |
| `features/{offers,search,compare,providers}`, `pages/{search,compare,providers}` | F2 | FE-FLIGHT (+ `fare-calendar`, `route-map`) |
| `features/{trips,saved,alerts,family,travelers,settings,account}` | F3 | BE-TRIPS (`trips`) |
| `features/{assistant,bookings}` | F4 | BOOK-REDIRECT (`bookings`, `pages/demo-supplier`) |
| `e2e/**` | QA | QA, ובהמשך E2E-V6 |
| `package.json` | F1 | FE-FLIGHT בלבד (תלויות מפה) |

## תשתית ותיעוד
| נתיב | בעלים |
|---|---|
| `scripts/**`, `.github/workflows/ori-travel-ai.yml`, `docs/operations/**` | D1, ובהמשך DEVOPS-RELEASE |
| `docs/security/audit-report.md` | AUD, ובהמשך RELEASE-AUDIT (נספח תיקונים: מנהל) |
| `docs/integrations/providers*.md`, `provider-capability-matrix.md` | R1, ובהמשך PROV-ANALYST |
| `docs/release/**` | מנהל (+ UX-DS: `design-system.md`) |
| `docs/agents/**`, `docs/architecture/**` | מנהל |
