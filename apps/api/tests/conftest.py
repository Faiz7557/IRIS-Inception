import base64
import os

os.environ.setdefault("PROFILE_ENC_KEY_V1", base64.b64encode(b"\x01" * 32).decode())
os.environ.setdefault("PROFILE_ENC_KEY_V2", base64.b64encode(b"\x02" * 32).decode())
os.environ.setdefault("WS_TICKET_SECRET", "test-ticket-secret-0123456789abcdef")
os.environ.setdefault("CONSOLE_JWT_SECRET", "test-console-secret-0123456789abcdef")
os.environ.setdefault("CONSOLE_PASSCODE", "sandi-juri")
os.environ.pop("DATABASE_URL", None)
