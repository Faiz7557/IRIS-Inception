"""Contact notifications (TRD 10): halaman (WS hub), Web Push, simulated SMS."""
import asyncio
import json
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable
from uuid import UUID

import config
import crypto
import db

log = logging.getLogger("jembatan112.notify")

# set by orchestrator so the console can show "sms_simulated"
console_sms_sink: Callable[[UUID, dict], Awaitable[None]] | None = None

_WS_TYPE = {"panggilan_dibuat": "state", "fallback": "fallback", "dispatch": "dispatch", "selesai": "ended"}


class ContactHub:
    """user_id -> live /ws/contact sockets. ponytail: per process."""

    def __init__(self) -> None:
        self._conns: dict[UUID, set] = defaultdict(set)

    def register(self, user_id: UUID, ws) -> None:
        self._conns[user_id].add(ws)

    def unregister(self, user_id: UUID, ws) -> None:
        self._conns[user_id].discard(ws)
        if not self._conns[user_id]:
            self._conns.pop(user_id, None)

    async def broadcast(self, user_id: UUID, msg: dict) -> int:
        """Send to every socket of this user's contacts; returns sockets reached."""
        sent = 0
        for ws in list(self._conns.get(user_id, ())):
            try:
                await ws.send_json(msg)
                sent += 1
            except Exception:
                self.unregister(user_id, ws)
        return sent


contact_hub = ContactHub()


def mask_phone(phone: str) -> str:
    return phone[:6] + "****" + phone[-4:] if len(phone) > 10 else "****"


def sms_text(incident: str, name: str | None, address: str | None, lat, lng) -> str:
    kejadian = config.INCIDENTS.get(incident, config.INCIDENTS["umum"])["label"].upper()
    gps = f" GPS: https://maps.google.com/?q={lat},{lng}" if lat is not None and lng is not None else ""
    return (f"DARURAT {kejadian}. Saya {name or 'pengguna'}, tuli, tidak bisa menelepon.\n"
            f"Lokasi: {address or 'belum diketahui'}.{gps}\n"
            "Tolong hubungi 112 untuk saya. (Jembatan 112)")


def _push_sync(sub: dict, payload: dict) -> None:
    from pywebpush import webpush  # lazy: optional at import time
    key = config.env("VAPID_PRIVATE_KEY")
    if not key:
        raise RuntimeError("vapid_not_configured")
    webpush(subscription_info=sub, data=json.dumps(payload), vapid_private_key=key,
            vapid_claims={"sub": config.env("VAPID_SUBJECT", "mailto:admin@example.com")}, ttl=3600)


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
            payload = {"title": f"Darurat: {label}", "body": f"{name or 'Seseorang'} meminta bantuan. Ketuk untuk lokasi."}
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
