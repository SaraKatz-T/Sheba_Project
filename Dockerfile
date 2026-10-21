# בנייה להעלאה ל-Railway: שירות אחד שמגיש גם את ה-API וגם את הלקוח מאותה כתובת.

# --- שלב 1: בניית הלקוח (React) ---
FROM node:22-slim AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- שלב 2: השרת (Python) ---
FROM python:3.14-slim
# Tesseract לזיהוי סיבוב העמוד (בלינוקס הוא מותקן כך, ולא מ-C:\Program Files)
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ ./
COPY --from=client /client/dist /app/client/dist

ENV PYTHONUNBUFFERED=1 \
    CLIENT_DIST=/app/client/dist \
    STORAGE_DIR=/data

# Railway נותן את הפורט במשתנה PORT.
# proxy-headers: כדי שהגבלת ניסיונות הכניסה תראה את הכתובת של המשתמש ולא של Railway
CMD uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips="*"
