"""REST endpoints (Schema 4.2) + /ws/contact/{token}. Call WebSockets live in orchestrator."""
import hashlib
import json
import logging
import re
import secrets
from typing import Literal
from uuid import UUID

import asyncpg
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

import auth
import config
import crypto
import db
from notify import contact_hub
from protocol import CreateCall

log = logging.getLogger("jembatan112.routes")
router = APIRouter()

CONSENT_REQUIRED_MSG = "Simpan data medis hanya setelah Anda memberi persetujuan."


def _err(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message, **extra})


def _need_db() -> None:
    if not db.enabled():
        raise _err(503, "UPSTREAM_UNAVAILABLE", "Layanan data sedang tidak tersedia. Coba lagi sebentar.")


def _sha(s: str) -> bytes:
    return hashlib.sha256(s.encode()).digest()


async def _ensure_profile(uid: UUID) -> None:
    await db.execute("insert into public.profiles (user_id) values ($1) on conflict do nothing", uid)


def _enc(v: str | None, table: str, col: str, uid: UUID) -> bytes | None:
    return crypto.encrypt(v, table, col, uid) if v else None


def _dec(blob, table: str, col: str, uid: UUID) -> str | None:
    return crypto.decrypt(blob, table, col, uid) if blob else None


# ---------------------------------------------------------------- profile
BloodType = Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]


class ProfileIn(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=40)
    address: str | None = Field(None, max_length=160)
    landmark: str | None = Field(None, max_length=80)
    blood_type: BloodType | None = None
    medical_notes: str | None = Field(None, max_length=120)
    segment: Literal["A", "B", "C", "D"] = "A"
    practice_mode: bool = True
    silent_mode: bool = False
    large_text: bool = False
    double_tap_sos: bool = False


_PCOLS = {"display_name": "display_name_enc", "address": "address_enc", "landmark": "landmark_enc",
          "medical_notes": "medical_notes_enc", "blood_type": "blood_type_enc"}
_PFLAGS = ("segment", "practice_mode", "silent_mode", "large_text", "double_tap_sos")


def _profile_out(row: dict | None, uid: UUID) -> dict:
    row = row or {}
    out = {k: _dec(row.get(c), "profiles", c, uid) for k, c in _PCOLS.items()}
    out.update(segment=row.get("segment", "A"), practice_mode=row.get("practice_mode", True),
               silent_mode=row.get("silent_mode", False), large_text=row.get("large_text", False),
               double_tap_sos=row.get("double_tap_sos", False))
    return out


def _consent_out(row: dict | None) -> dict:
    at = (row or {}).get("medical_consent_at")
    return {"granted": at is not None, "version": (row or {}).get("medical_consent_version"), "at": at}


def _opener_preview(profile: dict, consent: bool) -> str | None:
    try:
        from opener import build_opener
    except ImportError:
        return None
    p = dict(profile, medical_consent=consent)
    if not consent:
        p["medical_notes"] = p["blood_type"] = None
    return build_opener(p, "umum", None, None)


@router.get("/v1/me/profile")
async def get_profile(uid: UUID = Depends(auth.current_user)):
    _need_db()
    row = await db.fetch_one("select * from public.profiles where user_id = $1", uid)
    profile, consent = _profile_out(row, uid), _consent_out(row)
    return {"profile": profile, "medical_consent": consent,
            "opener_preview": _opener_preview(profile, consent["granted"])}


@router.put("/v1/me/profile")
async def put_profile(body: ProfileIn, uid: UUID = Depends(auth.current_user)):
    _need_db()
    row = await db.fetch_one("select * from public.profiles where user_id = $1", uid)
    consent = _consent_out(row)
    if (body.medical_notes or body.blood_type) and not consent["granted"]:
        raise _err(422, "CONSENT_REQUIRED", CONSENT_REQUIRED_MSG)
    vals = [_enc(getattr(body, k), "profiles", c, uid) for k, c in _PCOLS.items()]
    await db.execute(
        "insert into public.profiles (user_id, display_name_enc, address_enc, landmark_enc, medical_notes_enc, "
        "blood_type_enc, segment, practice_mode, silent_mode, large_text, double_tap_sos) "
        "values ($1,$2,$3,$4,$5,$6,$7::public.user_segment,$8,$9,$10,$11) "
        "on conflict (user_id) do update set display_name_enc=excluded.display_name_enc, "
        "address_enc=excluded.address_enc, landmark_enc=excluded.landmark_enc, "
        "medical_notes_enc=excluded.medical_notes_enc, blood_type_enc=excluded.blood_type_enc, "
        "segment=excluded.segment, practice_mode=excluded.practice_mode, silent_mode=excluded.silent_mode, "
        "large_text=excluded.large_text, double_tap_sos=excluded.double_tap_sos",
        uid, *vals, *(getattr(body, k) for k in _PFLAGS))
    profile = body.model_dump(include=set(_PCOLS) | set(_PFLAGS))
    return {"profile": profile, "medical_consent": consent,
            "opener_preview": _opener_preview(profile, consent["granted"])}


class ConsentIn(BaseModel):
    kind: Literal["syarat_layanan", "data_medis", "korpus_anonim"]
    version: str = Field(min_length=1, max_length=60)
    granted: bool


@router.post("/v1/me/consents")
async def post_consent(body: ConsentIn, uid: UUID = Depends(auth.current_user)):
    _need_db()
    await _ensure_profile(uid)
    args = (uid, body.kind, body.version, body.granted)
    ins = "insert into public.consent_log (user_id, kind, version, granted) values ($1,$2::public.consent_kind,$3,$4)"
    if body.kind != "data_medis":
        row = await db.fetch_one(ins + " returning at", *args)
    elif body.granted:  # single statement = one transaction
        row = await db.fetch_one(
            f"with l as ({ins} returning at) update public.profiles set medical_consent_at = (select at from l), "
            "medical_consent_version = $3 where user_id = $1 returning (select at from l) as at", *args)
    else:  # revoke: clear medical columns in the same statement
        row = await db.fetch_one(
            f"with l as ({ins} returning at) update public.profiles set medical_consent_at = null, "
            "medical_consent_version = null, medical_notes_enc = null, blood_type_enc = null "
            "where user_id = $1 returning (select at from l) as at", *args)
    return {"kind": body.kind, "version": body.version, "granted": body.granted, "at": (row or {}).get("at")}


@router.delete("/v1/me")
async def delete_me(uid: UUID = Depends(auth.current_user)):
    _need_db()
    if await db.fetch_one("select 1 as x from public.calls where user_id = $1 and state <> 'SELESAI' limit 1", uid):
        raise _err(409, "CONFLICT", "Selesaikan panggilan yang sedang berjalan sebelum menghapus akun.")
    await db.execute("delete from public.profiles where user_id = $1", uid)  # cascades to all user tables
    url, key = config.env("SUPABASE_URL"), config.env("SUPABASE_SERVICE_ROLE_KEY")
    auth_deleted = False
    if url and key:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.delete(f"{url.rstrip('/')}/auth/v1/admin/users/{uid}",
                                   headers={"Authorization": f"Bearer {key}", "apikey": key})
            auth_deleted = r.status_code in (200, 204, 404)
        except httpx.HTTPError as e:
            log.warning("auth admin delete failed: %s", type(e).__name__)
    return {"deleted": True, "auth_deleted": auth_deleted}


# ---------------------------------------------------------------- contacts
class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    phone: str = Field(pattern=r"^\+62[0-9]{8,13}$")
    relation: str | None = Field(None, max_length=30)


class ContactPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=60)
    phone: str | None = Field(None, pattern=r"^\+62[0-9]{8,13}$")
    relation: str | None = Field(None, max_length=30)


def _contact_out(r: dict, uid: UUID) -> dict:
    return {"id": r["id"], "name": _dec(r["name_enc"], "emergency_contacts", "name_enc", uid),
            "phone": _dec(r["phone_enc"], "emergency_contacts", "phone_enc", uid),
            "relation": r["relation"], "priority": r["priority"], "push_enabled": r["push_subscription"] is not None}


def _share(token: str) -> dict:
    url = f"{(config.env('PUBLIC_WEB_URL') or 'http://localhost:3000').rstrip('/')}/k/{token}"
    return {"status_url": url, "share_text": "Saya menambahkan Anda sebagai kontak darurat di Jembatan 112. "
            f"Buka tautan ini dan izinkan notifikasi: {url}"}


_CSEL = "id, name_enc, phone_enc, relation, priority, push_subscription"


@router.get("/v1/me/contacts")
async def list_contacts(uid: UUID = Depends(auth.current_user)):
    _need_db()
    rows = await db.fetch_all(f"select {_CSEL} from public.emergency_contacts where user_id = $1 order by priority", uid)
    return {"contacts": [_contact_out(r, uid) for r in rows]}


@router.post("/v1/me/contacts", status_code=201)
async def add_contact(body: ContactIn, uid: UUID = Depends(auth.current_user)):
    _need_db()
    await _ensure_profile(uid)
    used = {r["priority"] for r in await db.fetch_all("select priority from public.emergency_contacts where user_id = $1", uid)}
    free = [p for p in (1, 2, 3) if p not in used]
    if not free:
        raise _err(409, "CONFLICT", "Maksimal 3 kontak darurat.")
    token = secrets.token_urlsafe(32)
    try:
        row = await db.fetch_one(
            "insert into public.emergency_contacts (user_id, name_enc, phone_enc, relation, priority, status_token_hash) "
            f"values ($1,$2,$3,$4,$5,$6) returning {_CSEL}", uid,
            crypto.encrypt(body.name, "emergency_contacts", "name_enc", uid),
            crypto.encrypt(body.phone, "emergency_contacts", "phone_enc", uid),
            body.relation, free[0], _sha(token))
    except asyncpg.UniqueViolationError:  # lost a race for the slot
        raise _err(409, "CONFLICT", "Maksimal 3 kontak darurat.") from None
    return {"contact": _contact_out(row, uid), **_share(token)}


@router.patch("/v1/me/contacts/{cid}")
async def patch_contact(cid: UUID, body: ContactPatch, uid: UUID = Depends(auth.current_user)):
    _need_db()
    row = await db.fetch_one(f"select {_CSEL} from public.emergency_contacts where id = $1 and user_id = $2", cid, uid)
    if not row:
        raise _err(404, "NOT_FOUND", "Kontak tidak ditemukan.")
    if body.name:
        row["name_enc"] = crypto.encrypt(body.name, "emergency_contacts", "name_enc", uid)
    if body.phone:
        row["phone_enc"] = crypto.encrypt(body.phone, "emergency_contacts", "phone_enc", uid)
    if "relation" in body.model_fields_set:
        row["relation"] = body.relation
    await db.execute("update public.emergency_contacts set name_enc=$3, phone_enc=$4, relation=$5 "
                     "where id=$1 and user_id=$2", cid, uid, row["name_enc"], row["phone_enc"], row["relation"])
    return {"contact": _contact_out(row, uid)}


@router.delete("/v1/me/contacts/{cid}", status_code=204)
async def delete_contact(cid: UUID, uid: UUID = Depends(auth.current_user)):
    _need_db()
    if not await db.fetch_one("delete from public.emergency_contacts where id = $1 and user_id = $2 returning id", cid, uid):
        raise _err(404, "NOT_FOUND", "Kontak tidak ditemukan.")


@router.post("/v1/me/contacts/{cid}/rotate-token")
async def rotate_token(cid: UUID, uid: UUID = Depends(auth.current_user)):
    _need_db()
    token = secrets.token_urlsafe(32)
    if not await db.fetch_one("update public.emergency_contacts set status_token_hash = $3, push_subscription = null, "
                              "push_subscribed_at = null where id = $1 and user_id = $2 returning id", cid, uid, _sha(token)):
        raise _err(404, "NOT_FOUND", "Kontak tidak ditemukan.")
    return _share(token)


# ---------------------------------------------------------------- devices
class DeviceIn(BaseModel):
    device_key: UUID
    user_agent: str | None = Field(None, max_length=300)


async def _upsert_device(uid: UUID, key: UUID, ua: str | None) -> UUID:
    await _ensure_profile(uid)
    row = await db.fetch_one(
        "insert into public.devices (user_id, device_key_hash, user_agent) values ($1,$2,$3) "
        "on conflict (user_id, device_key_hash) do update set last_seen_at = now() returning id", uid, _sha(str(key)), ua)
    return row["id"]


@router.post("/v1/me/devices")
async def post_device(body: DeviceIn, request: Request, uid: UUID = Depends(auth.current_user)):
    _need_db()
    ua = body.user_agent or request.headers.get("user-agent", "")[:300] or None
    return {"device_id": await _upsert_device(uid, body.device_key, ua)}


# ---------------------------------------------------------------- calls
LIMITS = {"latihan": (30, None), "other": (3, 10)}  # (per hour, per day)

_RATE_SQL = (
    "select count(*) filter (where sos_confirmed_at > now() - interval '1 hour') as last_hour, "
    "count(*) filter (where sos_confirmed_at > now() - interval '1 day') as last_day, "
    "extract(epoch from now() - min(sos_confirmed_at) filter (where sos_confirmed_at > now() - interval '1 hour')) as hour_age_s, "
    "extract(epoch from now() - min(sos_confirmed_at) filter (where sos_confirmed_at > now() - interval '1 day')) as day_age_s "
    "from public.calls where user_id = $1 and device_id = $2 and mode {op} 'latihan'")


async def _check_rate(uid: UUID, device_id: UUID, mode: str) -> None:
    practice = mode == "latihan"
    r = await db.fetch_one(_RATE_SQL.format(op="=" if practice else "<>"), uid, device_id) or {}
    per_hour, per_day = LIMITS["latihan" if practice else "other"]
    wait = 0
    if r.get("last_hour", 0) >= per_hour:
        wait = max(1, 3600 - int(r.get("hour_age_s") or 0))
    if per_day and r.get("last_day", 0) >= per_day:
        wait = max(wait, 1, 86400 - int(r.get("day_age_s") or 0))
    if wait:
        raise _err(429, "RATE_LIMITED", f"Terlalu banyak panggilan. Coba lagi dalam {max(1, wait // 60)} menit.",
                   retry_after_s=wait)


async def _load_profile(uid: UUID) -> dict | None:
    row = await db.fetch_one("select * from public.profiles where user_id = $1", uid)
    if not row:
        return None
    p = _profile_out(row, uid)
    consent = row.get("medical_consent_at") is not None
    if not consent:
        p["medical_notes"] = p["blood_type"] = None
    p["medical_consent"] = consent
    return p


@router.post("/v1/calls", status_code=201)
async def create_call(body: CreateCall, request: Request, uid: UUID = Depends(auth.current_user)):
    _need_db()
    device_id = await _upsert_device(uid, body.device_key, request.headers.get("user-agent", "")[:300] or None)
    await _check_rate(uid, device_id, body.mode)
    profile = await _load_profile(uid)
    try:
        import orchestrator
    except ImportError:
        raise _err(503, "UPSTREAM_UNAVAILABLE", "Layanan panggilan belum siap.") from None
    try:
        return await orchestrator.start_call(uid, device_id, body, profile)
    except ValueError as e:
        if str(e) == "CONFLICT":
            raise _err(409, "CONFLICT", "Anda masih punya panggilan yang belum selesai.") from None
        raise


_CALL_COLS = ("id, mode, incident, state, sos_confirmed_at, answered_at, dispatched_at, ended_at, end_reason, "
              "degradation_max, attempt_count")


@router.get("/v1/calls")
async def list_calls(uid: UUID = Depends(auth.current_user)):
    _need_db()
    return {"calls": await db.fetch_all(f"select {_CALL_COLS} from public.calls where user_id = $1 "
                                        "order by sos_confirmed_at desc limit 50", uid)}


@router.get("/v1/calls/{call_id}")
async def get_call(call_id: UUID, uid: UUID = Depends(auth.current_user)):
    _need_db()
    row = await db.fetch_one(f"select {_CALL_COLS}, user_id from public.calls where id = $1", call_id)
    if not row:
        raise _err(404, "NOT_FOUND", "Panggilan tidak ditemukan.")
    if row.pop("user_id") != uid:
        raise _err(403, "FORBIDDEN", "Panggilan ini bukan milik Anda.")
    return row


# ---------------------------------------------------------------- console
class LoginIn(BaseModel):
    passcode: str = Field(min_length=1, max_length=200)


def console_auth(authorization: str | None = Header(None)) -> None:
    try:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise PermissionError("missing")
        auth.verify_console_jwt(authorization[7:].strip())
    except PermissionError:
        raise _err(401, "UNAUTHENTICATED", "Sesi konsol tidak valid. Masuk lagi.") from None


@router.post("/v1/console/login")
async def console_login(body: LoginIn):
    if not auth.check_console_passcode(body.passcode):
        raise _err(401, "UNAUTHENTICATED", "Sandi salah.")
    try:
        return {"token": auth.issue_console_jwt(), "expires_in": auth.CONSOLE_TTL_S}
    except PermissionError:
        raise _err(503, "UPSTREAM_UNAVAILABLE", "Konsol belum dikonfigurasi.") from None


@router.get("/v1/console/calls", dependencies=[Depends(console_auth)])
async def console_calls():
    try:
        import orchestrator
    except ImportError:
        return {"calls": []}
    return {"calls": await orchestrator.active_calls()}


@router.get("/v1/metrics/summary", dependencies=[Depends(console_auth)])
async def metrics_summary():
    _need_db()
    return await db.fetch_one("select * from public.v_metrics_summary") or {}


# ---------------------------------------------------------------- contact page
async def _contact_row(token: str) -> dict | None:
    return await db.fetch_one(
        "select ec.id, ec.user_id, p.display_name_enc from public.emergency_contacts ec "
        "join public.profiles p on p.user_id = ec.user_id where ec.status_token_hash = $1", _sha(token))


def _ws_base(request: Request) -> str:
    base = config.env("PUBLIC_WS_URL") or config.env("NEXT_PUBLIC_WS_URL")
    return (base or re.sub(r"^http", "ws", str(request.base_url))).rstrip("/")


@router.get("/v1/contact/{token}")
async def get_contact(token: str, request: Request):
    _need_db()
    ec = await _contact_row(token)
    if not ec:
        raise _err(404, "NOT_FOUND", "Tautan tidak dikenal.")
    c = await db.fetch_one(
        "select c.incident, c.state, c.lat, c.lng, c.gps_accuracy_m, c.sos_confirmed_at, c.answered_at, "
        "c.dispatched_at, c.ended_at from public.calls c where c.user_id = $1 and c.mode <> 'latihan' "
        "and c.sos_confirmed_at > now() - interval '24 hours' order by c.sos_confirmed_at desc limit 1", ec["user_id"])
    active = None
    if c:
        loc = None
        if c["lat"] is not None and c["lng"] is not None:
            loc = {"lat": c["lat"], "lng": c["lng"], "accuracy_m": c["gps_accuracy_m"],
                   "maps_url": f"https://maps.google.com/?q={c['lat']},{c['lng']}"}
        active = {"incident": c["incident"], "state": c["state"], "location": loc,
                  **{k: c[k] for k in ("sos_confirmed_at", "answered_at", "dispatched_at", "ended_at")}}
    return {"user_display_name": _dec(ec["display_name_enc"], "profiles", "display_name_enc", ec["user_id"]),
            "active_call": active, "ws_url": f"{_ws_base(request)}/ws/contact/{token}"}


@router.post("/v1/contact/{token}/push")
async def contact_push(token: str, body: dict):
    _need_db()
    sub = body.get("subscription", body)
    if not isinstance(sub, dict) or not sub.get("endpoint") or not isinstance(sub.get("keys"), dict):
        raise _err(400, "VALIDATION_ERROR", "Langganan notifikasi tidak valid.")
    sub = {"endpoint": sub["endpoint"], "keys": sub["keys"]}
    if not await db.fetch_one("update public.emergency_contacts set push_subscription = $2::jsonb, "
                              "push_subscribed_at = now() where status_token_hash = $1 returning id",
                              _sha(token), json.dumps(sub)):
        raise _err(404, "NOT_FOUND", "Tautan tidak dikenal.")
    return {"ok": True}


@router.get("/v1/push/vapid-public-key")
async def vapid_key():
    key = config.env("VAPID_PUBLIC_KEY")
    if not key:
        raise _err(503, "UPSTREAM_UNAVAILABLE", "Notifikasi push belum dikonfigurasi.")
    return {"public_key": key}


@router.websocket("/ws/contact/{token}")
async def ws_contact(ws: WebSocket, token: str):
    ec = await _contact_row(token) if db.enabled() else None
    if not ec:
        await ws.close(code=4404)
        return
    await ws.accept()
    uid = ec["user_id"]
    contact_hub.register(uid, ws)
    try:
        while True:
            await ws.receive_text()  # contacts only listen; drain pings
    except WebSocketDisconnect:
        pass
    finally:
        contact_hub.unregister(uid, ws)
