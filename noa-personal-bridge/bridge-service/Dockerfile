# Local use only (no deployment pipeline). Build from noa-personal-bridge/bridge-service:
#   docker build -t noa-bridge .
#   docker run --rm -p 127.0.0.1:8787:8787 --env-file .env -v noa-bridge-data:/app/data noa-bridge
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
VOLUME ["/app/data"]
CMD ["python", "-m", "bridge_service.main"]
