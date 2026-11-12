# packages/shared

מקור האמת לחוזה בין השרת לממשק הוא **מסמך ה-OpenAPI של ה-API**, ולא קוד משותף.

* בזמן ריצה (מחוץ ל-production): `http://localhost:8000/api/openapi.json` (ותיעוד אינטראקטיבי ב-`/api/docs`).
* קובץ מיוצא לעיון ולהשוואת שינויים: [`openapi.json`](openapi.json) (נוצר אוטומטית, לא נערך ידנית).

## ייצוא מחדש

הסקריפט טוען את האפליקציה בזיכרון (מסד נתונים זמני, בלי שרת ובלי מפתחות) וכותב את הקובץ:

```powershell
.\apps\api\.venv\Scripts\python .\scripts\export-openapi.py
```

```bash
apps/api/.venv/bin/python scripts/export-openapi.py
```

אפשר להעביר נתיב אחר כארגומנט ראשון. הקובץ ממוין ויציב, כך ש-`git diff` מראה רק שינויי חוזה אמיתיים.

## עבודה עם החוזה

1. משנים Pydantic schema או router ב-`apps/api`.
2. מייצאים מחדש ובודקים את ה-diff של `openapi.json`: שינוי שובר (שדה שהוסר, סוג שהשתנה) דורש עדכון של סכמות Zod בממשק (`apps/web/src/lib/schemas`).
3. תיאור ידני של נקודות הקצה נמצא ב-[api-contract.md](../../docs/architecture/api-contract.md); במקרה של סתירה, ה-OpenAPI קובע.
