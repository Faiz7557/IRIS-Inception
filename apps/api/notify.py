"""Contact notifications (TRD 10): halaman (WS hub), Web Push, simulated SMS."""
import asyncio
import base64
import ipaddress
import json
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit
from uuid import UUID

import config
import crypto
import db

log = logging.getLogger("jembatan112.notify")

# set by orchestrator so the console can show "sms_simulated"
console_sms_sink: Callable[[UUID, dict], Awaitable[None]] | None = None

_WS_TYPE = {"panggilan_dibuat": "state", "fallback": "fallback", "dispatch": "dispatch", "selesai": "ended"}


class ContactHub:
    """user_id -> contact_id -> live /ws/contact sockets. ponytail: per process."""

    def __init__(self) -> None:
        self._conns: dict[UUID, dict[UUID, set]] = defaultdict(lambda: defaultdict(set))

    def register(self, user_id: UUID, contact_id: UUID, ws) -> None:
        self._conns[user_id][contact_id].add(ws)

    def unregister(self, user_id: UUID, contact_id: UUID, ws) -> None:
        by_contact = self._conns.get(user_id)
        if by_contact is None:
            return
        socks = by_contact.get(contact_id)
        if socks is not None:
            socks.discard(ws)
            if not socks:
                by_contact.pop(contact_id, None)
        if not by_contact:
            self._conns.pop(user_id, None)

    async def broadcast(self, user_id: UUID, msg: dict) -> int:
        """Send to every socket of every contact of this user; returns sockets reached."""
        sent = 0
        for cid, socks in list(self._conns.get(user_id, {}).items()):
            for ws in list(socks):
                try:
                    await ws.send_json(msg)
                    sent += 1
                except Exception:
                    self.unregister(user_id, cid, ws)
        return sent

    async def close(self, *, user_id: UUID | None = None, contact_id: UUID | None = None, code: int = 4401) -> int:
        """Close sockets of one contact (deleted / token rotated) or all of a user's contacts."""
        doomed = []
        for uid, by_contact in list(self._conns.items()):
            if user_id is not None and uid != user_id:
                continue
            for cid in list(by_contact):
                if contact_id is None or cid == contact_id:
                    doomed += list(by_contact.pop(cid))
            if not by_contact:
                self._conns.pop(uid, None)
        for ws in doomed:
            try:
                await ws.close(code=code)
            except Exception:
                pass
        return len(doomed)


contact_hub = ContactHub()


def mask_phone(phone: str) -> str:
    return phone[:6] + "****" + phone[-4:] if len(phone) > 10 else "****"


def sms_text(incident: str, name: str | None, address: str | None, lat, lng) -> str:
    kejadian = config.INCIDENTS.get(incident, config.INCIDENTS["umum"])["label"].upper()
    gps = f" GPS: https://maps.google.com/?q={lat},{lng}" if lat is not None and lng is not None else ""
    return (f"DARURAT {kejadian}. Saya {name or 'pengguna'}, tuli, tidak bisa menelepon.\n"
            f"Lokasi: {address or 'belum diketahui'}.{gps}\n"
            "Tolong hubungi 112 untuk saya. (Jembatan 112)")


_PUSH_HOSTS = {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}
_PUSH_SUFFIXES = (".push.apple.com", ".notify.windows.com")
PUSH_TIMEOUT_S = 10


def push_endpoint_ok(url) -> bool:
    """SSRF guard: https on a known browser push service only (no IP literals, creds or odd ports)."""
    if not isinstance(url, str) or len(url) > 2048:
        return False
    try:
        u = urlsplit(url)
        port = u.port
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    if u.scheme != "https" or u.username or u.password or port not in (None, 443) or not host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return host in _PUSH_HOSTS or host.endswith(_PUSH_SUFFIXES)


def landing_url(sub: dict, user_id: UUID) -> str:
    """Absolute contact page URL; the /k/<token> path is stored encrypted next to the subscription."""
    base = (config.env("PUBLIC_WEB_URL") or "http://localhost:3000").rstrip("/")
    try:
        return base + crypto.decrypt(base64.b64decode(sub["path_enc"]), "emergency_contacts",
                                     "push_subscription", user_id)
    except Exception:
        return base + "/"


def _push_sync(sub: dict, payload: dict) -> None:
    import requests
    from pywebpush import webpush  # lazy: optional at import time
    if not push_endpoint_ok(sub.get("endpoint")):  # re-check: rows may predate validation
        raise ValueError("push endpoint not allowed")
    key = config.env("VAPID_PRIVATE_KEY")
    if not key:
        raise RuntimeError("vapid_not_configured")
    with requests.Session() as s:
        s.max_redirects = 0  # any redirect raises TooManyRedirects instead of being followed
        s.trust_env = False
        webpush(subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]}, data=json.dumps(payload),
                vapid_private_key=key, vapid_claims={"sub": config.env("VAPID_SUBJECT", "mailto:admin@example.com")},
                ttl=3600, timeout=PUSH_TIMEOUT_S, requests_session=s)


async def _record(call_id, contact_id, channel: str, trigger: str, err: str | None) -> bool:
    await db.execute(
        "insert into public.notifications (call_id, contact_id, channel, trigger, status, sent_at, error) "
        "values ($1,$2,$3::public.notify_channel,$4,$5::public.notify_status, "
        "case when $5 = 'terkirim' then now() end, $6)",
        call_id, contact_id, channel, trigger, "gagal" if err else "terkirim", err[:300] if err else None)
    return err is None


async def notify_contacts(call_id: UUID, user_id: UUID, trigger: str, mode: str) -> int:
    """Returns number of contacts reached by at least one channel. No-op in latihan."""
    if mode == "latihan" or not db.enabled():
        return 0
    contacts = await db.fetch_all(
        "select id, name_enc, phone_enc, push_subscription from public.emergency_contacts "
        "where user_id = $1 order by priority", user_id)
    if not contacts:
        return 0
    call = await db.fetch_one("select incident, lat, lng from public.calls where id = $1", call_id) or {}
    prof = await db.fetch_one("select display_name_enc, address_enc from public.profiles where user_id = $1",
                              user_id) or {}

    def dec(col: str) -> str | None:
        try:
            return crypto.decrypt(prof[col], "profiles", col, user_id) if prof.get(col) else None
        except Exception:
            return None

    name, address, incident = dec("display_name_enc"), dec("address_enc"), call.get("incident", "umum")
    label = config.INCIDENTS.get(incident, config.INCIDENTS["umum"])["label"]
    ok_contacts: set = set()

    # halaman: realtime broadcast once, one row per contact
    err = None
    try:
        await contact_hub.broadcast(user_id, {"type": _WS_TYPE.get(trigger, "state"),
                                              "data": {"call_id": str(call_id), "incident": incident,
                                                       "trigger": trigger}})
    except Exception as e:
        err = type(e).__name__
    for c in contacts:
        if await _record(call_id, c["id"], "halaman", trigger, err):
            ok_contacts.add(c["id"])

    for c in contacts:
        if trigger in ("fallback", "dispatch") and c["push_subscription"]:
            sub = c["push_subscription"]
            sub = json.loads(sub) if isinstance(sub, str) else sub
            payload = {"title": f"Darurat: {label}", "body": f"{name or 'Seseorang'} meminta bantuan. Ketuk untuk lokasi.",
                       "url": landing_url(sub, user_id)}
            try:
                await asyncio.to_thread(_push_sync, sub, payload)
                e2 = None
            except Exception as e:
                e2 = f"{type(e).__name__}: {e}"
            if await _record(call_id, c["id"], "web_push", trigger, e2):
                ok_contacts.add(c["id"])
        if trigger == "fallback":
            try:
                phone = crypto.decrypt(c["phone_enc"], "emergency_contacts", "phone_enc", user_id)
                if console_sms_sink:
                    await console_sms_sink(call_id, {"to": mask_phone(phone), "text": sms_text(
                        incident, name, address, call.get("lat"), call.get("lng"))})
                e3 = None
            except Exception as e:
                e3 = type(e).__name__
            if await _record(call_id, c["id"], "sms_simulasi", trigger, e3):
                ok_contacts.add(c["id"])

    if ok_contacts:
        await db.execute("update public.calls set contacts_notified_at = now() "
                         "where id = $1 and contacts_notified_at is null", call_id)
    return len(ok_contacts)
