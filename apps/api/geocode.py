"""Reverse geocoding via Nominatim, rate-limited to 1 request per second."""

import asyncio
import time

import httpx

from config import env

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"

# ponytail: one global lock serialises all callers, fine for MVP traffic; per-key cache if it grows
_lock = asyncio.Lock()
_last_call = 0.0


async def reverse_geocode(lat: float, lng: float) -> str | None:
    global _last_call
    headers = {"User-Agent": env("NOMINATIM_USER_AGENT", "jembatan112/1.0")}
    params = {"format": "jsonv2", "lat": lat, "lon": lng, "accept-language": "id"}
    try:
        async with _lock:
            wait = _last_call + 1.0 - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            _last_call = time.monotonic()
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(NOMINATIM_URL, params=params, headers=headers)
            resp.raise_for_status()
            address = resp.json().get("address") or {}
        parts = [
            address.get("road"),
            address.get("suburb") or address.get("village"),
            address.get("city"),
        ]
        joined = ", ".join(p for p in parts if p)
        return joined or None
    except Exception:
        return None
