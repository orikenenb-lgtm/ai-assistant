# 🧸 Kerem Orders

מערכת ניהול הזמנות לעסק סיטונאות צעצועים, מחוברת ל-**Rivhit Online**.

לקוחות סיטונאיים מזמינים מקטלוג אישי, אבא מקבל התראה (Email + Telegram),
סוקר את ההזמנה בדשבורד, ומפיק הצעת מחיר ישירות ל-Rivhit — עם dry-run ואישור לפני כל כתיבה.

## מבנה הפרויקט

```
├── backend/    # FastAPI + Supabase + Rivhit (Python 3.11)
├── frontend/   # React 19 + TypeScript + Vite + Tailwind v4 (עברית RTL)
├── docs/       # ארכיטקטורה והחלטות
└── .claude/    # הגדרות תת-הסוכנים
```

## הרצה מקומית

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # ומלא ערכים אמיתיים
.venv/bin/uvicorn app.main:app --reload
# בדיקה: curl http://localhost:8000/health
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env        # ומלא ערכים אמיתיים
npm run dev                 # http://localhost:5173
```

### בדיקות

```bash
cd backend && .venv/bin/python -m pytest tests/ -v
cd frontend && npm run build
```

## 🔐 אבטחה — כללי ברזל

- **Secrets רק ב-`.env`** (חסום ב-gitignore) — לעולם לא בקוד.
- טוקן Rivhit חי **בבקנד בלבד**.
- הרשאות בשתי שכבות: RLS ב-Supabase + dependencies ב-FastAPI.
- Dry-run תמיד לפני כתיבה ל-Rivhit; כתיבת production רק באישור מפורש.

פירוט מלא: [docs/architecture.md](docs/architecture.md) · [מדריך deploy](docs/deployment.md) · [סיכום אבטחה](docs/security.md)
