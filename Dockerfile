# Production Dockerfile for Jembatan 112 API (FastAPI)
FROM python:3.12-slim-bookworm AS builder

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1

# Install uv for fast dependency resolution
COPY --from=ghcr.io/astral-sh/uv:0.5.26 /uv /uvx /bin/

# Copy and install backend dependencies
COPY apps/api/requirements.txt requirements.txt
RUN uv pip install --no-cache -r requirements.txt

# Runner stage
FROM python:3.12-slim-bookworm AS runner

WORKDIR /app/apps/api

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/usr/local/bin:$PATH" \
    PYTHONPATH="/app/apps/api" \
    PORT=8000

# Copy site-packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy backend application source
COPY apps/api /app/apps/api

# Run as non-root app user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')" || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
