# Dockerfile של הבקנד — נבנה על ידי Railway דרך railway.json שבשורש הריפו.
# שים לב: ה-build context הוא שורש הריפו (לא backend/), ולכן הנתיבים ב-COPY
# מתחילים ב-backend/. אין צורך להגדיר Root Directory ב-Railway.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# רק קוד האפליקציה — בלי בדיקות, סקריפטים או .env (מוגן גם ב-.dockerignore)
COPY backend/app ./app

EXPOSE 8000

# Railway מזריק PORT בזמן ריצה; ברירת מחדל 8000 להרצה מקומית
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
