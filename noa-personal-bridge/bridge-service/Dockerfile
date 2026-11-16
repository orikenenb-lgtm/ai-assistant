# Build from noa-personal-bridge/bridge-service:
#   docker build -t noa-bridge .
#   docker run --rm -p 127.0.0.1:8787:8787 --env-file .env -v noa-bridge-data:/app/data noa-bridge
# Hosted (Railway): see railway.json next to this file and docs/noa-personal-bridge/INSTALLATION_HE.md.
# No VOLUME instruction (Railway rejects it) — mount a persistent volume at /app/data instead.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BRIDGE_HOST=0.0.0.0 \
    BRIDGE_PORT=8787 \
    BRIDGE_DB_PATH=/app/data/bridge.sqlite3

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY bridge_service ./bridge_service
RUN useradd --system --uid 10001 --home /app bridge \
    && mkdir -p /app/data && chown bridge /app/data && chmod 700 /app/data
USER bridge

EXPOSE 8787
# Hosting platforms inject $PORT; fall back to 8787 locally.
CMD ["sh", "-c", "BRIDGE_PORT=${PORT:-8787} exec python -m bridge_service.main"]
