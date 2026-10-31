import importlib
import logging
import os
import re
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import auth
import db

log = logging.getLogger("jembatan112")

auth.check_dev_flags()  # before routers import orchestrator (it reads J112_FAKE_PROVIDERS at import)


class RedactSecrets(logging.Filter):
    """Strips WS tickets / contact tokens from uvicorn access + websocket log lines."""
    _RX = (re.compile(r"((?:ticket|token)=)[^&\s\"']+", re.I),
           re.compile(r"(/(?:ws|v1)/contact/|/k/)[^/?\s\"']+"))

    def _clean(self, v):
        if isinstance(v, str):
            for rx in self._RX:
                v = rx.sub(r"\1[REDACTED]", v)
        return v

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self._clean(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(self._clean(a) for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {k: self._clean(a) for k, a in record.args.items()}
        return True


_redact = RedactSecrets()


def install_log_redaction() -> None:
    for name in ("uvicorn.access", "uvicorn.error"):
        logging.getLogger(name).addFilter(_redact)  # idempotent: same instance


install_log_redaction()

_CODES = {400: "VALIDATION_ERROR", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND",
          409: "CONFLICT", 422: "CONSENT_REQUIRED", 429: "RATE_LIMITED", 503: "UPSTREAM_UNAVAILABLE"}


def err(status: int, code: str, message: str, headers: dict | None = None, **extra) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message, **extra}}, status, headers=headers)


@asynccontextmanager
async def lifespan(app: FastAPI):
    install_log_redaction()  # again, in case uvicorn reconfigured logging after import
    await db.init_pool()
    try:
        if not auth.fake_providers():  # fake mode: no Google calls at boot
            from relay.tts import tts
            await tts.startup()
    except Exception as e:
        log.warning("tts.startup skipped: %s: %s", type(e).__name__, e)
    yield
    await db.close_pool()


app = FastAPI(title="Jembatan 112 API", lifespan=lifespan)

RATE, WINDOW = 60, 60.0
_buckets: dict[str, tuple[float, float]] = {}  # ip -> (tokens, last); ponytail: per process


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path.startswith("/v1/"):
        ip = request.client.host if request.client else "?"
        now = time.monotonic()
        tokens, last = _buckets.get(ip, (float(RATE), now))
        tokens = min(RATE, tokens + (now - last) * RATE / WINDOW)
        if tokens < 1:
            wait = int((1 - tokens) * WINDOW / RATE) + 1
            _buckets[ip] = (tokens, now)
            return err(429, "RATE_LIMITED", f"Terlalu banyak permintaan. Coba lagi dalam {wait} detik.",
                       headers={"Retry-After": str(wait)}, retry_after_s=wait)
        _buckets[ip] = (tokens - 1, now)
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["Strict-Transport-Security"] = "max-age=31536000"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Permissions-Policy"] = "geolocation=(self), microphone=(self)"
    return resp


app.add_middleware(  # added last = outermost, so error responses carry CORS headers
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    allow_methods=["*"], allow_headers=["*"], allow_credentials=False,
)


@app.exception_handler(StarletteHTTPException)
async def http_err(request: Request, exc: StarletteHTTPException):
    d = exc.detail
    body = dict(d) if isinstance(d, dict) and "code" in d else {"code": _CODES.get(exc.status_code, "INTERNAL"), "message": str(d)}
    return JSONResponse({"error": body}, exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_err(request: Request, exc: RequestValidationError):
    fields = [".".join(str(p) for p in e["loc"]) for e in exc.errors()]
    return err(400, "VALIDATION_ERROR", "Data yang dikirim tidak valid.", fields=fields)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "db": db.enabled()}


# routers owned by other tasks; skip if missing so the app boots
for _mod in ("routes", "orchestrator"):
    try:
        app.include_router(importlib.import_module(_mod).router)
    except Exception as e:
        log.warning("router %s not loaded: %s: %s", _mod, type(e).__name__, e)
