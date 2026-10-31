# AGENTS_BRIEF: shared contract for every build agent

Read this file first. Then read ONLY the doc sections named in your task. Do not read whole docs.
Docs live in `../docs/` (relative to this repo root). Repo root = `jembatan-112/`.

## Rules for all agents

1. Touch ONLY the files your task owns (see ownership table). Never edit another owner's file. If you need something from another module, code against the interface below; if the interface is missing something, write a `TODO(integrator): ...` comment and continue.
2. Match the interfaces below exactly (names, args, return types). The integrator merges by these names.
3. Language: code identifiers English or as named below; user-facing strings Indonesian (from docs).
4. No secrets in code. Read env vars listed in `../docs/03_TRD.md` §14.
5. Python 3.12 syntax (runs on 3.12+ / 3.13+ locally). Can run from repo root via uv (`uv sync`, `uv run pytest`, `uv run uvicorn main:app --app-dir apps/api --port 8000`) or from `apps/api` with flat imports (`from relay.simplifier import simplify`). Root `requirements.txt` forwards to `apps/api/requirements.txt`. Tests in `apps/api/tests/` with pytest, no network (fake external clients).
6. TypeScript strict. Next.js 15 App Router, React 19, Tailwind 4. No extra UI libraries.
7. Leave ONE runnable check behind for non-trivial logic (a pytest file or a tiny self-check). No test frameworks beyond pytest/vitest.
8. Do NOT git commit. Do NOT run deploys. Do NOT call real paid APIs except where your task says so.
9. If a Claude Code "Fact-Forcing Gate" hook blocks a file write, state the facts it asks for in one line and retry the same call.
10. Finish with a report of at most 15 lines: files written, checks run + result, open TODOs. No file dumps.

## Layout and ownership

| Path | Owner task |
|---|---|
| `.gitignore`, `LICENSE`, `.env.example`, `README.md`, `pyproject.toml`, `requirements.txt`, `uv.lock`, `supabase/config.toml`, `eval/utterances.csv` | T01 scaffold |
| `apps/api/config.py`, `apps/api/protocol.py`, `apps/web/lib/protocol.ts`, `apps/web/lib/incidents.ts`, `supabase/migrations/0001_init.sql` | T02 contracts |
| `apps/web/` skeleton: `package.json`, configs, `app/layout.tsx`, `app/globals.css`, `app/manifest.ts`, `lib/supabase.ts`, `lib/api.ts` | T03 web skeleton |
| `apps/api/` skeleton: `requirements.txt`, `main.py`, `db.py`, `auth.py`, `crypto.py`, `tests/test_crypto.py`, `tests/test_auth.py` | T04 api core |
| `apps/web/components/icons/*`, `apps/web/lib/copy.ts` | T05 icons + copy |
| `apps/api/orchestrator.py`, `apps/api/tests/test_orchestrator.py` | T06 orchestrator |
| `apps/api/relay/simplifier.py`, `apps/api/tests/test_simplifier.py` | T07 simplifier |
| `apps/api/relay/stt.py`, `apps/api/tests/test_stt.py` | T08 STT |
| `apps/api/relay/tts.py`, `apps/api/tests/test_tts.py` | T09 TTS |
| `apps/api/opener.py`, `apps/api/dispatch.py`, `apps/api/geocode.py`, `apps/api/tests/test_opener_dispatch.py` | T10 opener |
| `apps/api/routes.py`, `apps/api/notify.py`, `apps/api/tests/test_routes.py` | T11 REST + notify |
| `apps/web/app/(pengguna)/page.tsx`, `apps/web/app/(pengguna)/panggilan/**`, `apps/web/components/{IncidentTile,SosHoldButton,CallHeader,QuestionCard,ShortInputSheet,HelpTimeline}.tsx`, `apps/web/lib/ws-client.ts`, `apps/web/lib/geo.ts` | T12 PWA call flow |
| `apps/web/app/(pengguna)/{mulai,masuk,profil,kontak,pengaturan,riwayat}/**`, `apps/web/app/k/**`, `apps/web/app/offline/**`, `apps/web/public/sw.js`, `apps/web/lib/offline-store.ts` | T13 PWA account + contact + offline |
| `apps/web/app/konsol/**`, `apps/web/public/audio-worklet.js`, `apps/web/lib/console-audio.ts` | T14 operator console |
| `eval/report.py` | T15 eval report |
| `eval/run_eval.py` | T16 eval runner |
| everything (glue only) | T17 integrator |

`apps/api/relay/__init__.py` is created empty by T04.

## Backend interfaces (Python)

```python
# config.py (T02)
RING_TIMEOUT_S = 30; MAX_ATTEMPTS = 3; MAX_TOTAL_ATTEMPTS = 6
WAIT_TICK_S = 8; LLM_TIMEOUT_S = 1.5; HALF_DUPLEX_TAIL_S = 0.3; USER_LINK_LOST_S = 15
INCIDENTS: dict[str, dict]   # id -> {"label": "Kebakaran", "phrase": "kebakaran", "ready_phrases": [3 str]}; ids per docs (incl. "umum")
PHRASES: dict[str, str]      # P_INTRO, P_WAIT, P_REPEAT, P_YES, P_NO, P_DONTKNOW, P_UNDERSTOOD, P_REPEAT_INSTR, P_CANCEL, P_USER_LOST, P_TYPED_PREFIX, P_DIGITS_1..P_DIGITS_5
def env(name: str, default: str | None = None) -> str | None

# protocol.py (T02) - pydantic v2
class CallState(StrEnum)  # SIAGA .. SELESAI
Incident = Literal[...]; Kind = Literal["ya_tidak","angka","lokasi","pilihan","terbuka","instruksi"]
Action = Literal["ucap","kirim_gps","ketik","ulangi"]
class Option(BaseModel): label: str; action: Action; spoken: str
class Card(BaseModel): card_id: UUID; kind: Kind; question: str; transcript: str; options: list[Option]; degradation: int = 0
class Location(BaseModel): lat; lng; accuracy_m; captured_at
class CreateCall(BaseModel): incident; mode: Literal["latihan","simulasi"]; device_key: UUID; location: Location | None; client_ts
class Envelope(BaseModel): v: int = 1; type: str; seq: int; call_id: UUID; ts: datetime; data: dict
def card_for_client(card: Card) -> dict   # strips "spoken", options get "index"

# db.py (T04)
async def init_pool() -> None; async def close_pool() -> None
async def fetch_one(sql: str, *args) -> dict | None; async def fetch_all(sql, *args) -> list[dict]; async def execute(sql, *args) -> None
def log_event(call_id, seq, event, from_state, to_state, ignored=False, payload=None) -> None  # non-blocking queue writer
async def insert_call(**fields) -> UUID; async def update_call(call_id, **fields) -> None
async def upsert_turn(**fields) -> None   # keyed by card_id

# auth.py (T04)
async def current_user(authorization: str = Header(...)) -> UUID   # FastAPI dependency, Supabase JWT
def issue_ws_ticket(call_id: UUID, user_id: UUID, role: str) -> str; def verify_ws_ticket(ticket: str, call_id: UUID) -> UUID  # single use, 60 s
def issue_console_jwt() -> str; def verify_console_jwt(token: str) -> None   # raises PermissionError
# crypto.py (T04)
def encrypt(plain: str, table: str, column: str, user_id: UUID) -> bytes
def decrypt(blob: bytes, table: str, column: str, user_id: UUID) -> str

# relay/stt.py (T08)
@dataclass class Utterance: text: str; confidence: float | None; speech_end_at: datetime; final_at: datetime
class DeepgramStream:
    def __init__(self, codec: Literal["pcm16_16k","mulaw_8k"], on_final, on_partial, on_error)  # async callbacks
    async def start(self) -> None; async def send_audio(self, frame: bytes) -> None
    def mute(self, muted: bool) -> None   # muted: drop frames, send KeepAlive every 4 s
    async def close(self) -> None

# relay/simplifier.py (T07)
@dataclass class SimplifyResult: cards: list[Card]; llm_status: str; degradation: int
    input_tokens: int | None; output_tokens: int | None; cache_read_tokens: int | None
    llm_start_at: datetime; llm_end_at: datetime
async def simplify(transcript: str, incident: str, history: list[dict], force_fail: bool = False) -> SimplifyResult
def generic_card(transcript: str) -> Card   # L1

# relay/tts.py (T09)
class TTS:
    force_fail: bool
    async def startup(self) -> None   # synthesize + cache PHRASES
    async def speak(self, text: str, fmt: Literal["pcm24k","mulaw8k"] = "pcm24k") -> AsyncIterator[bytes]
    def cached(self, phrase_key: str) -> bytes | None
tts = TTS()   # module singleton

# opener.py / dispatch.py / geocode.py (T10)
def build_opener(profile: dict | None, incident: str, location: dict | None, address_text: str | None) -> str
def gps_utterance(address_text: str | None, lat: float, lng: float, accuracy_m: float) -> str
def format_coord(x: float) -> str   # 5 decimals, comma decimal: -7,25752
def is_dispatch(text: str) -> bool; def is_repeat_opener(text: str) -> bool
async def reverse_geocode(lat: float, lng: float) -> str | None

# notify.py (T11)
async def notify_contacts(call_id: UUID, user_id: UUID, trigger: str, mode: str) -> int   # returns contacts notified; no-op in "latihan"
class ContactHub: async def broadcast(self, user_id: UUID, msg: dict) -> None
contact_hub = ContactHub()
console_sms_sink: Callable[[UUID, dict], Awaitable[None]] | None = None  # set by orchestrator to show "sms_simulated" in console

# orchestrator.py (T06)
router = APIRouter()   # WS: /ws/calls/{call_id}/user, /ws/calls/{call_id}/operator, /ws/console
async def start_call(user_id: UUID, device_id: UUID | None, req: CreateCall, profile: dict | None) -> dict  # returns POST /v1/calls response body
async def active_calls() -> list[dict]   # for GET /v1/console/calls

# routes.py (T11)
router = APIRouter()   # all REST in ../docs/04_Backend_Schema.md §4 + WS /ws/contact/{token}
# main.py (T04): app = FastAPI(); includes routes.router and orchestrator.router; startup: db.init_pool(), tts.startup()
```

## Frontend interfaces (TypeScript)

```ts
// lib/protocol.ts (T02): mirror of protocol.py + every WS message type in ../docs/04_Backend_Schema.md §5 as discriminated unions
// lib/incidents.ts (T02): export const INCIDENTS: {id, label, colorVar, icon}[]  (6 tiles, ids match config.py)
// lib/copy.ts (T05): export const COPY: Record<string,string>  (keys from 02_Design_Brief §11)
// components/icons/index.tsx (T05): export function IncidentIcon({ id, size }: {id: string; size?: number})
// lib/supabase.ts (T03): export const supabase
// lib/api.ts (T03): export async function api<T>(path: string, init?: RequestInit): Promise<T>  // adds Bearer token, base NEXT_PUBLIC_API_URL, throws ApiError{code,message,status}
// lib/ws-client.ts (T12): export class CallSocket { constructor(url: string, ticket: string); on(type, handler); send(type, data); close() }  // seq/ack/resume/backoff
// lib/offline-store.ts (T13): saveLocalProfile(p), saveLocalContacts(c), loadLocal(): Promise<{profile, contacts}>, clearLocal()
```

CSS tokens come from `../docs/02_Design_Brief.md` §5.1 as CSS variables in `app/globals.css` (T03).
