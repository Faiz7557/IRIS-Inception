import time
from unittest.mock import patch
from uuid import uuid4

import jwt
import pytest
from fastapi import HTTPException

import auth

CALL, USER = uuid4(), uuid4()


def test_ticket_valid_once():
    t = auth.issue_ws_ticket(CALL, USER, "user")
    assert auth.verify_ws_ticket(t, CALL) == USER
    with pytest.raises(PermissionError):
        auth.verify_ws_ticket(t, CALL)


def test_ticket_expired():
    with patch("auth.time.time", return_value=time.time() - 120):
        t = auth.issue_ws_ticket(CALL, USER, "user")
    with pytest.raises(PermissionError):
        auth.verify_ws_ticket(t, CALL)


def test_ticket_wrong_call_and_tamper():
    t = auth.issue_ws_ticket(CALL, USER, "user")
    with pytest.raises(PermissionError):
        auth.verify_ws_ticket(t, uuid4())
    with pytest.raises(PermissionError):
        auth.verify_ws_ticket(t[:-2] + "AA", CALL)
    with pytest.raises(PermissionError):
        auth.verify_ws_ticket("garbage", CALL)


def test_console_jwt_and_passcode():
    auth.verify_console_jwt(auth.issue_console_jwt())
    with pytest.raises(PermissionError):
        auth.verify_console_jwt("x.y.z")
    assert auth.check_console_passcode("sandi-juri") and not auth.check_console_passcode("salah")


async def test_supabase_hs256(monkeypatch):
    secret = "s" * 40
    monkeypatch.setenv("SUPABASE_JWT_SECRET", secret)
    now = int(time.time())

    def mk(key=secret, **c):
        return jwt.encode({"sub": str(USER), "aud": "authenticated", "exp": now + 60, **c}, key, "HS256")

    assert await auth.current_user(f"Bearer {mk()}") == USER
    for bad in (mk(aud="anon"), mk(exp=now - 5), mk(key="w" * 40)):
        with pytest.raises(HTTPException) as e:
            await auth.current_user(f"Bearer {bad}")
        assert e.value.status_code == 401
    with pytest.raises(HTTPException):
        await auth.current_user(None)
