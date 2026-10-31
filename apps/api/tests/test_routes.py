import hashlib
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import auth
import db
import notify
from main import app

UID = uuid4()
H = {"Authorization": "Bearer x"}


@pytest.fixture
def client(monkeypatch):
    app.dependency_overrides[auth.current_user] = lambda: UID
    monkeypatch.setattr(db, "enabled", lambda: True)
    yield TestClient(app)
    app.dependency_overrides.clear()


def fake_db(monkeypatch, fetch_one=None, fetch_all=None):
    async def noop(*a, **k):
        return None

    async def none(*a, **k):
        return None

    async def empty(*a, **k):
        return []
    monkeypatch.setattr(db, "execute", noop)
    monkeypatch.setattr(db, "fetch_one", fetch_one or none)
    monkeypatch.setattr(db, "fetch_all", fetch_all or empty)


def test_profile_medical_needs_consent(client, monkeypatch):
    async def f1(sql, *a):
        return {"medical_consent_at": None, "medical_consent_version": None}
    fake_db(monkeypatch, f1)
    r = client.put("/v1/me/profile", json={"display_name": "Rina", "medical_notes": "Asma"}, headers=H)
    assert r.status_code == 422 and r.json()["error"]["code"] == "CONSENT_REQUIRED"
    r = client.put("/v1/me/profile", json={"display_name": "Rina"}, headers=H)
    assert r.status_code == 200 and r.json()["profile"]["display_name"] == "Rina"


def test_fourth_contact_conflict(client, monkeypatch):
    async def full(sql, *a):
        return [{"priority": 1}, {"priority": 2}, {"priority": 3}]
    fake_db(monkeypatch, fetch_all=full)
    r = client.post("/v1/me/contacts", json={"name": "Ibu", "phone": "+6281234567890"}, headers=H)
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    bad = client.post("/v1/me/contacts", json={"name": "Ibu", "phone": "0812"}, headers=H)
    assert bad.status_code == 400


def test_rate_limit_429(client, monkeypatch):
    async def f1(sql, *a):
        if "devices" in sql:
            return {"id": uuid4()}
        if "from public.calls" in sql:
            return {"last_hour": 3, "last_day": 3, "hour_age_s": 600, "day_age_s": 600}
        return None
    fake_db(monkeypatch, f1)
    body = {"incident": "kebakaran", "mode": "simulasi", "device_key": str(uuid4()),
            "client_ts": "2026-10-31T21:14:05Z"}
    r = client.post("/v1/calls", json=body, headers=H)
    assert r.status_code == 429
    e = r.json()["error"]
    assert e["code"] == "RATE_LIMITED" and e["retry_after_s"] == 3000
    assert client.post("/v1/calls", json={**body, "mode": "produksi"}, headers=H).status_code == 400


def test_console_login(monkeypatch):
    c = TestClient(app)
    r = c.post("/v1/console/login", json={"passcode": "sandi-juri"})
    assert r.status_code == 200
    auth.verify_console_jwt(r.json()["token"])
    bad = c.post("/v1/console/login", json={"passcode": "salah"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "UNAUTHENTICATED"
    assert c.get("/v1/console/calls").status_code == 401
    assert c.get("/v1/console/calls", headers={"Authorization": "Bearer " + r.json()["token"]}).status_code == 200


def test_no_db_503():
    app.dependency_overrides[auth.current_user] = lambda: UID
    try:
        r = TestClient(app).get("/v1/me/profile", headers=H)
        assert r.status_code == 503 and r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    finally:
        app.dependency_overrides.clear()


def test_contact_token_is_hashed(client, monkeypatch):
    seen = []

    async def f1(sql, *a):
        seen.append(a)
        return None
    fake_db(monkeypatch, f1)
    r = client.get("/v1/contact/abc123")
    assert r.status_code == 404
    assert seen[0] == (hashlib.sha256(b"abc123").digest(),)


async def test_notify_noop_in_latihan(monkeypatch):
    monkeypatch.setattr(db, "enabled", lambda: True)

    async def boom(*a, **k):
        raise AssertionError("db touched")
    monkeypatch.setattr(db, "fetch_all", boom)
    assert await notify.notify_contacts(uuid4(), UID, "panggilan_dibuat", "latihan") == 0
