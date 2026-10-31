"""Regression checks for the F1 security fixes."""
import base64
import json
import logging
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import auth
import db
import main
import notify
from main import app

CALL, USER = uuid4(), uuid4()


# 1: dev flags gated by J112_ENV
@pytest.mark.parametrize("env", [None, "prod", "production", "staging"])
def test_dev_flags_refused_outside_dev(monkeypatch, env):
    if env is None:
        monkeypatch.delenv("J112_ENV", raising=False)
    else:
        monkeypatch.setenv("J112_ENV", env)
    monkeypatch.setenv("J112_DEV_USER", str(USER))
    monkeypatch.setenv("J112_FAKE_PROVIDERS", "1")
    assert auth.dev_user() is None and not auth.fake_providers()
    with pytest.raises(RuntimeError):
        auth.check_dev_flags()


async def test_dev_user_honored_only_in_dev(monkeypatch, caplog):
    monkeypatch.setenv("J112_DEV_USER", str(USER))
    monkeypatch.setenv("J112_ENV", "dev")
    with caplog.at_level(logging.WARNING):
        auth.check_dev_flags()
    assert "ACTIVE" in caplog.text
    assert await auth.current_user(None) == USER
    monkeypatch.setenv("J112_ENV", "prod")
    with pytest.raises(Exception):
        await auth.current_user(None)


def test_no_flags_boots_in_prod(monkeypatch):
    monkeypatch.delenv("J112_ENV", raising=False)
    monkeypatch.delenv("J112_DEV_USER", raising=False)
    monkeypatch.delenv("J112_FAKE_PROVIDERS", raising=False)
    auth.check_dev_flags()


# 2 + 11: ticket encodings and uniqueness
def test_padded_and_reencoded_ticket_rejected():
    t = auth.issue_ws_ticket(CALL, USER, "user")
    p64, sig = t.split(".")
    variants = [f"{p64}.{sig}=", f"{p64}==.{sig}", f"{p64}.{sig}==", f"{p64}.{sig}\n", f"{p64}.+{sig}"]
    for v in variants:
        with pytest.raises(PermissionError):
            auth.verify_ws_ticket(v, CALL)
    assert auth.verify_ws_ticket(t, CALL) == USER
    for v in [t, *variants]:
        with pytest.raises(PermissionError):
            auth.verify_ws_ticket(v, CALL)


def test_trailing_bits_variant_rejected():
    t = auth.issue_ws_ticket(CALL, USER, "user")
    p64, sig = t.split(".")
    raw = base64.urlsafe_b64decode(sig + "=" * (-len(sig) % 4))
    alt = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    assert alt == sig  # canonical form round-trips
    # flip unused low bits of the last char (32-byte sig -> 43 chars, last char carries 2 spare bits)
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    bumped = sig[:-1] + alphabet[alphabet.index(sig[-1]) ^ 1]
    with pytest.raises(PermissionError):
        auth.verify_ws_ticket(f"{p64}.{bumped}", CALL)


def test_tickets_unique_within_one_second():
    assert len({auth.issue_ws_ticket(CALL, USER, "user") for _ in range(50)}) == 50


# 3: push SSRF
@pytest.mark.parametrize("url", [
    "http://fcm.googleapis.com/fcm/send/x", "https://127.0.0.1/x", "https://[::1]/x", "https://10.0.0.5/x",
    "https://169.254.169.254/latest", "https://evil.com/x", "https://fcm.googleapis.com.evil.com/x",
    "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "file:///etc/passwd", "", None,
])
def test_push_endpoint_rejected(url):
    assert not notify.push_endpoint_ok(url)


@pytest.mark.parametrize("url", [
    "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/QX", "https://api.push.apple.com/x", "https://wns2-par02p.notify.windows.com/w/?t=1",
])
def test_push_endpoint_allowed(url):
    assert notify.push_endpoint_ok(url)


def test_push_route_rejects_ssrf(monkeypatch):
    monkeypatch.setattr(db, "enabled", lambda: True)

    async def boom(*a, **k):
        raise AssertionError("db touched")
    monkeypatch.setattr(db, "fetch_one", boom)
    r = TestClient(app).post("/v1/contact/tok/push",
                             json={"endpoint": "http://169.254.169.254/x", "keys": {"p256dh": "a", "auth": "b"}})
    assert r.status_code == 400


def test_push_sync_refuses_bad_stored_endpoint():
    with pytest.raises(ValueError):
        notify._push_sync({"endpoint": "https://10.0.0.1/x", "keys": {}}, {})


# 13: push payload carries landing url
def test_push_stores_path_and_payload_has_url(monkeypatch):
    uid, cid = uuid4(), uuid4()
    stored = {}
    monkeypatch.setattr(db, "enabled", lambda: True)
    monkeypatch.setenv("PUBLIC_WEB_URL", "https://j112.example/")

    async def f1(sql, *a):
        if sql.startswith("select"):
            return {"id": cid, "user_id": uid}
        stored["sub"] = json.loads(a[1])
        return {"id": cid}
    monkeypatch.setattr(db, "fetch_one", f1)
    r = TestClient(app).post("/v1/contact/tok123/push", json={"subscription": {
        "endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": {"p256dh": "a", "auth": "b"}}})
    assert r.status_code == 200
    assert "tok123" not in json.dumps(stored["sub"])  # token never stored in clear
    assert notify.landing_url(stored["sub"], uid) == "https://j112.example/k/tok123"
    assert notify.landing_url({}, uid) == "https://j112.example/"


# 4: log redaction
def test_access_log_redaction():
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                            ("1.2.3.4:5", "GET", "/ws/call/abc?ticket=SECRET.SIG&x=1", "1.1", 101), None)
    main._redact.filter(rec)
    line = rec.getMessage()
    assert "SECRET" not in line and "ticket=[REDACTED]&x=1" in line
    for path in ("/v1/contact/TOKEN123/push", "/ws/contact/TOKEN123", "/k/TOKEN123", "/x?token=TOKEN123"):
        rec = logging.LogRecord("uvicorn.error", logging.INFO, "", 0, '%s - "WebSocket %s" [accepted]',
                                ("1.2.3.4:5", path), None)
        main._redact.filter(rec)
        assert "TOKEN123" not in rec.getMessage()
    assert main._redact in logging.getLogger("uvicorn.access").filters
    assert main._redact in logging.getLogger("uvicorn.error").filters


# 5: contact sockets closed on delete / rotate
class FakeWS:
    def __init__(self):
        self.closed, self.sent = None, []

    async def send_json(self, m):
        self.sent.append(m)

    async def close(self, code=1000):
        self.closed = code


async def test_hub_close_per_contact_and_broadcast():
    hub, uid, c1, c2 = notify.ContactHub(), uuid4(), uuid4(), uuid4()
    a, b = FakeWS(), FakeWS()
    hub.register(uid, c1, a)
    hub.register(uid, c2, b)
    assert await hub.broadcast(uid, {"x": 1}) == 2
    assert await hub.close(contact_id=c1) == 1 and a.closed == 4401 and b.closed is None
    assert await hub.broadcast(uid, {"x": 2}) == 1 and len(a.sent) == 1
    hub.unregister(uid, c1, a)  # late unregister from the route's finally is harmless
    assert await hub.close(user_id=uid) == 1 and b.closed == 4401


@pytest.mark.parametrize("path,sql_ok", [("/v1/me/contacts/{cid}", "delete"),
                                         ("/v1/me/contacts/{cid}/rotate-token", "update")])
def test_delete_and_rotate_close_sockets(monkeypatch, path, sql_ok):
    uid, cid = uuid4(), uuid4()
    ws = FakeWS()
    notify.contact_hub.register(uid, cid, ws)
    app.dependency_overrides[auth.current_user] = lambda: uid
    monkeypatch.setattr(db, "enabled", lambda: True)

    async def f1(sql, *a):
        return {"id": cid} if sql.startswith(sql_ok) else None
    monkeypatch.setattr(db, "fetch_one", f1)
    try:
        c = TestClient(app)
        url = path.format(cid=cid)
        r = c.delete(url) if sql_ok == "delete" else c.post(url)
        assert r.status_code in (200, 204)
        assert ws.closed == 4401
    finally:
        app.dependency_overrides.clear()
        notify.contact_hub.unregister(uid, cid, ws)
