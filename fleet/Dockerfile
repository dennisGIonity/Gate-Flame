# Gate^Flame Fleet Dashboard — container image for a real server.
#   docker compose up -d --build        (see docker-compose.yml, README "Move to a real server")
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    GATEFLAME_FLEET_DB=/data/fleet.db

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin fleet \
 && mkdir -p /data && chown fleet:fleet /data
COPY --chown=fleet:fleet app.py ./
COPY --chown=fleet:fleet static ./static

USER fleet
VOLUME ["/data"]
EXPOSE 8091

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8091/healthz', timeout=4).status == 200 else 1)"

# --no-proxy-headers: the app reads X-Forwarded-* itself, and only from
# GATEFLAME_FLEET_TRUSTED_PROXIES. Letting uvicorn rewrite the client address
# first would make the proxy look untrusted and drop the path prefix.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091", "--no-proxy-headers", "--no-server-header"]
