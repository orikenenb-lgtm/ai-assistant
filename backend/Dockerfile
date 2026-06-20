# Dockerfile רב-שלבי: בונה את הפרונט (Node) ומגיש אותו יחד עם ה-API (Python).
# נבנה ע"י Railway דרך railway.json שבשורש הריפו. ה-build context הוא שורש הריפו.

# שלב 1 — בניית הפרונט
FROM node:22-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# התוצר: /fe/dist

# שלב 2 — שרת ה-API + הגשת הפרונט הבנוי
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
# הפרונט הבנוי — FastAPI מגיש אותו מ-/app/static (ראה main.py)
COPY --from=frontend /fe/dist ./static

EXPOSE 8000

# Railway מזריק PORT בזמן ריצה; ברירת מחדל 8000 להרצה מקומית
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
