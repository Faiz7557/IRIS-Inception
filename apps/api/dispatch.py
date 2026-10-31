"""Deterministic 'responders are on the way' detector (TRD 5.7)."""

import re

DISPATCH_RE = re.compile(
    r"\b(petugas|ambulans|ambulan|pemadam|damkar|polisi|tim|bantuan)\b"
    r".{0,40}"
    r"\b(dikirim|meluncur|berangkat|menuju|segera datang|sudah jalan|otw|dalam perjalanan)\b",
    re.IGNORECASE,
)


def is_dispatch(text: str) -> bool:
    return DISPATCH_RE.search(text) is not None


def is_repeat_opener(text: str) -> bool:
    """Operator asks to replay the opener (E8): 'ulang' plus 'alamat' or 'lokasi'."""
    lower = text.lower()
    return "ulang" in lower and ("alamat" in lower or "lokasi" in lower)
