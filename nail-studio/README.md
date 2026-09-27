# Nail Studio — אתר (Phase 1)

אתר תדמית פרימיום לסטודיו ציפורניים. עברית / RTL, Mobile-first.

**עיצוב:** "Rose Aura" — רקע בהיר ורדרד, טקסט שזיף, ורוד מוביל עם לילך ותכלת פסטליים · Noto Serif Hebrew + Heebo

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Motion · Lucide

## הרצה

```bash
cd nail-studio
npm install
npm run dev      # http://localhost:3000
npm run lint
npm run build
```

## איפה מזינים את פרטי העסק

**קובץ אחד בלבד:** `src/config/site.ts`

| שדה | מה זה | אם ריק |
|---|---|---|
| `name` | שם העסק | מוצג "Nail Studio" כללי |
| `owner` | שם בעלת העסק | השם לא מוצג |
| `contact.phone` | טלפון לתצוגה | השורה מוסתרת |
| `contact.whatsapp` | מספר בפורמט בינלאומי (`9725...`) | כפתור ושורת WhatsApp מוסתרים |
| `contact.instagram` / `tiktok` | קישור `https://` מלא | הקישור מוסתר |
| `contact.address` / `city` / `mapsUrl` | כתובת | השורה מוסתרת |
| `contact.openingHours` | `[{ days, hours }]` | השורה מוסתרת |
| `booking.url` | קישור למערכת תורים חיצונית | "קביעת תור" גולל ליצירת קשר |

ערכים ריקים או טוקנים כמו `NAIL_STUDIO_NAME` נחשבים "לא הוגדר" — לא מוצג מידע מזויף ולא קישור שבור.
קישורים שאינם `https://` נחסמים (הגנה מפני `javascript:` וכו').

תוכן נוסף:

- `src/data/services.ts` — טיפולים ומחירים (`price: null` → "מחיר יעודכן בהמשך")
- `src/data/gallery.ts` — עבודות. להוספת תמונה: שמים ב-`public/gallery` ומגדירים `image: { src, width, height }` + `alt` אמיתי
- `src/data/testimonials.ts` — **תוכן לדוגמה בלבד**, מסומן בממשק. מחליפים בהמלצות אמיתיות (`isDemo: false`)
- `src/data/about.ts` — הסיפור, תמונה, פילוסופיה
- `src/data/content.ts` — כל הטקסטים של הסקשנים (מוכן לתרגום/CMS)

## SEO והשקה

משתני סביבה (ראו `.env.example`):

- `NEXT_PUBLIC_SITE_URL` — הדומיין הסופי (canonical, OpenGraph, sitemap)
- `NEXT_PUBLIC_ALLOW_INDEXING=true` — רק בהשקה. עד אז האתר `noindex` ו-`robots.txt` חוסם, כדי שתוכן Placeholder לא ייכנס לגוגל

Structured data (`NailSalon`) נוצר אוטומטית **רק** כששם, טלפון, כתובת ועיר אמיתיים מוגדרים.

## מבנה

```
src/
├── app/            layout, page, not-found, robots, sitemap, icon
├── components/
│   ├── layout/     Header, MobileMenu, Footer
│   ├── sections/   Hero, TrustStrip, Services, Gallery(+Grid, Lightbox), About, Testimonials, CTA, Contact
│   ├── ui/         Button, Container, Section, SectionHeading, *Card, Aura, Reveal, Logo...
│   └── providers/  MotionProvider (LazyMotion + reduced motion)
├── config/site.ts  ← כל פרטי העסק
├── data/           תוכן
├── hooks/          useFocusTrap, useScrollLock, useActiveSection, useScrolled
├── lib/            utils, links, structured-data
└── types/
```
