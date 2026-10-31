"""AES-256-GCM column encryption (TRD 8.2).
Blob = version(1B) || nonce(12B) || ciphertext+tag. AAD = "{table}.{column}.{user_id}"."""
import base64
import os
from uuid import UUID

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_PFX = "PROFILE_ENC_KEY_V"


def _key(version: int) -> bytes:
    raw = os.environ.get(f"{_PFX}{version}")
    if not raw:
        raise KeyError(f"{_PFX}{version} not set")
    k = base64.b64decode(raw)
    if len(k) != 32:
        raise ValueError(f"{_PFX}{version} must decode to 32 bytes")
    return k


def _current_version() -> int:
    vs = [int(n[len(_PFX):]) for n in os.environ if n.startswith(_PFX) and n[len(_PFX):].isdigit()]
    if not vs:
        raise KeyError(f"{_PFX}1 not set")
    return max(vs)


def _aad(table: str, column: str, user_id: UUID) -> bytes:
    return f"{table}.{column}.{user_id}".encode()


def encrypt(plain: str, table: str, column: str, user_id: UUID, version: int | None = None) -> bytes:
    v = version or _current_version()
    nonce = os.urandom(12)
    ct = AESGCM(_key(v)).encrypt(nonce, plain.encode(), _aad(table, column, user_id))
    return bytes([v]) + nonce + ct


def decrypt(blob: bytes, table: str, column: str, user_id: UUID) -> str:
    blob = bytes(blob)
    if len(blob) < 1 + 12 + 16:
        raise ValueError("ciphertext too short")
    v, nonce, ct = blob[0], blob[1:13], blob[13:]
    return AESGCM(_key(v)).decrypt(nonce, ct, _aad(table, column, user_id)).decode()
