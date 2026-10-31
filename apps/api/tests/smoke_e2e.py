"""No-network end-to-end smoke test: one full call through a running API.

Start the server first (from apps/api):
    J112_ENV=dev J112_FAKE_PROVIDERS=1 J112_DEV_USER=<uuid> CONSOLE_PASSCODE=smoke CONSOLE_JWT_SECRET=<x> \
    WS_TICKET_SECRET=<y> PUBLIC_WS_URL=ws://127.0.0.1:8000 uvicorn main:app --port 8000
then: python tests/smoke_e2e.py   (env J112_API, CONSOLE_PASSCODE override the defaults)
"""
import asyncio
import json
import os
import sys
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import websockets

API = os.environ.get("J112_API", "http://127.0.0.1:8000")
WS = API.replace("http", "ws", 1)
PASS = os.environ.get("CONSOLE_PASSCODE", "smoke")


def ts() -> str:
    return datetime.now(UTC).isoformat()


def ok(step: str, detail: str = "") -> None:
    print(f"OK   {step}{(' - ' + detail) if detail else ''}", flush=True)


async def wait(ws, pred, what: str, timeout: float = 30.0, frames: list | None = None) -> dict:
    """Read until pred(msg) is true. Binary frames go into `frames`."""
    async def loop():
        while True:
            raw = await ws.recv()
            if isinstance(raw, bytes):
                if frames is not None:
                    frames.append(raw)
                continue
            m = json.loads(raw)
            if pred(m):
                return m
    try:
        return await asyncio.wait_for(loop(), timeout)
    except TimeoutError:
        raise SystemExit(f"FAIL {what}: timed out after {timeout}s") from None


def is_(t: str, **data):
    return lambda m: m.get("type") == t and all(m["data"].get(k) == v for k, v in data.items())


async def main() -> None:
    async with httpx.AsyncClient(base_url=API, timeout=10) as http:
        token = (await http.post("/v1/console/login", json={"passcode": PASS})).raise_for_status().json()["token"]
        ok("console login")
        async with websockets.connect(f"{WS}/ws/console?token={token}") as queue:
            r = await http.post("/v1/calls", json={
                "incident": "sakit", "mode": "latihan", "device_key": str(uuid4()), "client_ts": ts(),
                "location": {"lat": -7.2575, "lng": 112.7521, "accuracy_m": 20, "captured_at": ts()}})
            call = r.raise_for_status().json()
            cid = call["call_id"]
            ok("POST /v1/calls", f"{cid} state={call['state']}")
            dup = await http.post("/v1/calls", json={"mode": "latihan", "device_key": str(uuid4()), "client_ts": ts()})
            assert dup.status_code == 409 and dup.json()["error"]["call_id"] == cid, dup.text
            ok("second POST /v1/calls -> 409 with active call_id")
            await wait(queue, lambda m: m["type"] == "incoming_call" and m["call_id"] == cid, "incoming_call")
            ok("console queue: incoming_call")

        async with websockets.connect(f"{call['ws_url']}?ticket={call['ws_ticket']}") as user, \
                websockets.connect(f"{WS}/ws/calls/{cid}/operator?token={token}") as op:
            await user.send(json.dumps({"v": 1, "type": "resume", "data": {"last_seq": 0}}))
            await op.send(json.dumps({"type": "answer", "data": {"codec": "pcm16_16k"}}))
            m = await wait(user, lambda m: m["type"] == "opener" and "text" in m["data"], "opener")
            ok("console answer -> user opener", m["data"]["text"].splitlines()[0][:60] + "...")
            await wait(user, is_("state", state="MENDENGAR"), "MENDENGAR after opener")
            ok("opener spoken -> MENDENGAR")

            await op.send(json.dumps({"type": "operator_text", "data": {"text": "Korbannya masih sadar, Bu?"}}))
            card = (await wait(user, lambda m: m["type"] == "card", "card"))["data"]
            ok("operator_text -> user card", f"{card['question']} {[o['label'] for o in card['options']]} "
               f"index={card['index']}/{card['total']}")
            await user.send(json.dumps({"v": 1, "type": "card_shown", "data": {"card_id": card["card_id"], "client_ts": ts()}}))
            await user.send(json.dumps({"v": 1, "type": "tap", "data": {
                "card_id": card["card_id"], "option_index": 0, "client_ts": ts()}}))
            frames: list[bytes] = []
            log = await wait(op, lambda m: m["type"] == "log" and m["data"]["latency_a_ms"] is not None, "log A", frames=frames)
            ok("console log (latency A)", f"{log['data']['latency_a_ms']} ms")
            await wait(user, is_("answer_status", status="spoken"), "answer spoken", frames=None)
            while not any(f[:1] == b"\x02" for f in frames):  # drain audio frames sent around the log
                raw = await asyncio.wait_for(op.recv(), 5)
                if isinstance(raw, bytes):
                    frames.append(raw)
            audio = [f for f in frames if f[:1] == b"\x01"]
            assert audio and frames[-1] == b"\x02", [f[:1] for f in frames]
            ok("console audio", f"{len(audio)} x 0x01 chunk(s) ({sum(len(f) - 1 for f in audio)} B) + 0x02 end")
            ok("user tap -> answer_status spoken")
            await op.send(json.dumps({"type": "audio_started", "data": {"client_ts": ts()}}))
            log = await wait(op, lambda m: m["type"] == "log" and m["data"]["latency_b_ms"] is not None, "log B")
            ok("console audio_started -> log (latency B)", f"{log['data']['latency_b_ms']} ms")

            t = (await http.post(f"/v1/calls/{cid}/ticket")).raise_for_status().json()
            assert t["ws_ticket"] and t["ws_url"].endswith(f"/ws/calls/{cid}/user")
            ok("POST /v1/calls/{id}/ticket (reconnect ticket)")

            await op.send(json.dumps({"type": "dispatch", "data": {}}))
            d = await wait(user, lambda m: m["type"] == "dispatch", "dispatch")
            ok("console dispatch -> user dispatch", d["data"]["source"])
            await op.send(json.dumps({"type": "hangup", "data": {}}))
            e = await wait(user, lambda m: m["type"] == "ended", "ended")
            ok("console hangup -> user ended", f"reason={e['data']['reason']} duration={e['data']['duration_s']}s")
    print("SMOKE PASS", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except AssertionError as e:
        sys.exit(f"FAIL assertion: {e}")
