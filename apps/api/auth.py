"""Auth: Supabase JWT (JWKS / HS256), WS tickets, console JWT (TRD 8.1)."""
import asyncio
import base64
import hashlib
import hmac
import os
import secrets
import time
from uuid import UUID

import jwt
from fastapi import Header, HTTPException

_jwks: jwt.PyJWKClient | None = None
_used_tickets: dict[str, int] = {}  # sig -> exp; ponytail: in-memory, per process
_fallback_secret = secrets.token_bytes(32)

TICKET_TTL_S = 60
CONSOLE_TTL_S = 12 * 3600


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _unauth(msg: str = "Sesi tidak valid. Silakan masuk lagi.") -> HTTPException:
    return HTTPException(401, detail={"code": "UNAUTHENTICATED", "message": msg})


# ---- Supabase user JWT ----
def _jwks_client() -> jwt.PyJWKClient:
    global _jwks
    if _jwks is None:
        url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        if not url:
            raise PermissionError("SUPABASE_URL not set")
        _jwks = jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=600)
    return _jwks


def _verify_supabase_sync(token: str) -> UUID:
    alg = jwt.get_unverified_header(token).get("alg")
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if alg == "HS256" and secret:
        key, algs = secret, ["HS256"]
    else:
        key, algs = _jwks_client().get_signing_key_from_jwt(token).key, ["ES256", "RS256", "EdDSA"]
    claims = jwt.decode(token, key, algorithms=algs, audience="authenticated",
                        options={"require": ["exp", "sub"]})
    return UUID(claims["sub"])


async def verify_supabase_jwt(token: str) -> UUID:
    try:
        return await asyncio.to_thread(_verify_supabase_sync, token)
    except (jwt.PyJWTError, ValueError, PermissionError, OSError):
        raise _unauth() from None


async def current_user(authorization: str | None = Header(None)) -> UUID:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauth()
    return await verify_supabase_jwt(authorization[7:].strip())


# ---- WS ticket ----
def _ticket_secret() -> bytes:
    s = os.environ.get("WS_TICKET_SECRET")
    return s.encode() if s else _fallback_secret


def _mac(payload: str) -> bytes:
    return hmac.new(_ticket_secret(), payload.encode(), hashlib.sha256).digest()


def issue_ws_ticket(call_id: UUID, user_id: UUID, role: str) -> str:
    payload = f"{call_id}|{user_id}|{role}|{int(time.time()) + TICKET_TTL_S}"
    return f"{_b64(payload.encode())}.{_b64(_mac(payload))}"


def verify_ws_ticket(ticket: str, call_id: UUID) -> UUID:
    """Returns user_id. Raises PermissionError if bad, expired, wrong call, or reused."""
    try:
        p64, sig = ticket.split(".")
        payload = _unb64(p64).decode()
        if not hmac.compare_digest(_unb64(sig), _mac(payload)):
            raise PermissionError("bad signature")
        cid, uid, _role, exp = payload.split("|")
        exp = int(exp)
        user_id = UUID(uid)
        ticket_call = UUID(cid)
    except PermissionError:
        raise
    except Exception:
        raise PermissionError("malformed ticket") from None
    now = time.time()
    if exp < now:
        raise PermissionError("expired")
    if ticket_call != call_id:
        raise PermissionError("wrong call")
    for k in [k for k, e in _used_tickets.items() if e < now]:
        del _used_tickets[k]
    if sig in _used_tickets:
        raise PermissionError("ticket reused")
    _used_tickets[sig] = exp
    return user_id


# ---- Console ----
def _console_secret() -> str:
    s = os.environ.get("CONSOLE_JWT_SECRET")
    if not s:
        raise PermissionError("CONSOLE_JWT_SECRET not set")
    return s


def check_console_passcode(p: str) -> bool:
    expected = os.environ.get("CONSOLE_PASSCODE")
    if not expected:
        return False
    return hmac.compare_digest(p.encode(), expected.encode())


def issue_console_jwt() -> str:
    now = int(time.time())
    return jwt.encode({"role": "console", "iat": now, "exp": now + CONSOLE_TTL_S}, _console_secret(), "HS256")


def verify_console_jwt(token: str) -> None:
    try:
        c = jwt.decode(token, _console_secret(), algorithms=["HS256"], options={"require": ["exp"]})
    except jwt.PyJWTError as e:
        raise PermissionError(str(e)) from None
    if c.get("role") != "console":
        raise PermissionError("not a console token")
