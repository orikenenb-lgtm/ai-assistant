# סקירת ארכיטקטורה — Ori Travel AI

## במשפט אחד
אפליקציית web פרטית למשפחה. החזית בנויה ב-React בעברית מימין לשמאל, והשרת ב-FastAPI.
השרת מרכז חיפוש מכמה ספקי נסיעות דרך ממשק מתאמים אחיד, מנרמל את התוצאות לחוזה אחד
(`CanonicalOffer`), משווה ומדרג אותן בשקיפות, ושומר טיולים, מועדפים והתראות מחיר.
הוא מכין הזמנות עם אישור אנושי, אבל **לא מבצע רכישה אמיתית**.

## מבנה ה-monorepo

```
ori-travel-ai/
├── apps/
│   ├── api/                 FastAPI + SQLAlchemy 2 + Alembic (Python 3.12+)
│   │   ├── app/core/        config, db, auth deps, errors, crypto, redaction, ratelimit, money, audit
│   │   ├── app/models/      ORM: users, family, trips, search/offers, alerts, booking, system
│   │   ├── app/schemas/     חוזים משותפים: CanonicalOffer, פרמטרי חיפוש, Money, Page
│   │   ├── app/modules/     auth, family, travelers, providers, search, comparison,
│   │   │                    itineraries, saved, price_tracking, notifications,
│   │   │                    booking, ai, audit, settings, health
│   │   ├── alembic/         migrations (SQLite מקומי, תואם PostgreSQL)
│   │   └── tests/           pytest
│   └── web/                 React + TypeScript + Vite + Tailwind + TanStack Query + React Router + Zod
├── packages/shared/         הפניה לחוזים (מקור האמת: OpenAPI של ה-API)
├── docs/                    ארכיטקטורה, אבטחה, בדיקות, תפעול, סוכנים
├── scripts/                 PowerShell (Windows) + bash
└── tests/                   הערות על בדיקות בין-רכיביות
```

## שכבות בשרת

1. **Router** (דק): אימות קלט עם Pydantic, הרשאות דרך `Depends`, קריאה ל-service.
2. **Service:** לוגיקה עסקית, טרנזקציות ורישום ביקורת.
3. **מתאמי ספקים:** סינכרוניים, ללא גישה ל-DB. רצים במאגר תהליכונים מוגבל עם timeout לכל ספק.
4. **Models:** SQLAlchemy 2, מזהי UUID hex, זמנים תמיד ב-UTC, כסף ביחידות משנה.

## עקרונות מנחים

* **כנות נתונים:** כל הצעה נושאת `source.mode` (DEMO, LIVE או CACHED), חותמת זמן ותוקף.
  ממשק המשתמש מציג את התגיות האלה תמיד.
* **ה-AI לא ממציא מספרים:** הצ'אט מחזיר כרטיסי הצעות שהשרת מייצר מתוצאות החיפוש.
  מחירים שמופיעים בטקסט של המודל נבדקים מול תוצאות הכלים.
* **הזמנה בטוחה:** מכונת מצבים מפורשת. האישור קשור ל-hash של כל התנאים, ושינוי מהותי
  מבטל אותו. ביצוע אמיתי כבוי בקוד.
* **פרטיות:** פרטי דרכון ותאריך לידה מוצפנים. הלוגים מצונזרים. אין הרשמה ציבורית.
* **עובד בלי ענן:** SQLite מקומי, ספקי DEMO, AI אופציונלי (Ollama מקומי או ענן באישור מפורש בלבד).

## מצבי הרצה

* **פיתוח:** שני תהליכים. `uvicorn` על פורט 8000, ו-Vite על פורט 5173 עם proxy ל-`/api`.
* **הרצה מקומית "מלאה":** בונים את ה-web (`npm run build`), ו-FastAPI מגיש את `apps/web/dist`
  ואת ה-API מאותו מקור (פורט 8000). כך אין צורך ב-CORS.

פירוט זרימות הנתונים: [data-flow.md](data-flow.md). חוזי ה-API: [api-contract.md](api-contract.md).
