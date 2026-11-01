# Integration (T17)

## Fixed
- Orchestrator: simplifier history now `{operator, jawaban, action}`; llm_status `forced` -> `skipped` (DB enum); `notify_contacts("selesai")` on end; WS base from `PUBLIC_WS_URL` (fallback `NEXT_PUBLIC_WS_URL`, then `ws://localhost:8000`).
- Opener: no GPS -> "lokasi GPS tidak tersedia"; GPS > 100 m -> "lokasi GPS tidak akurat" (test added).
- Reconnect: `POST /v1/calls/{id}/ticket` (owner only, returns `ws_ticket` + `ws_url`); web `CallSocket` gets `getTicket` and retries a stale ticket once after reload.
- 409 on `POST /v1/calls` carries `error.call_id`; web `ApiError.details` exposes body fields; home opens the active call (E1).
- Web: `<RegisterSW/>` mounted; `/mulai` sets `j112.seen_intro`; `useGeo` writes `j112_last_gps`; offline redirect passes `?kejadian=`; card counter uses 0-based server index (+1).
- Console WS names and 0x01/0x02 audio framing verified against orchestrator (no change needed).
- `.env.example`: `PUBLIC_WEB_URL`, `PUBLIC_WS_URL`, `CORS_ORIGINS`, `DEEPGRAM_MODEL`, `J112_FAKE_PROVIDERS`, `J112_DEV_USER`.
- Kept as-is: TTS mid-stream failure may replay via fallback voice; STT 10 s no-results watchdog not built (marked `ponytail:` in `relay/stt.py`).

## Run locally
API (from `apps/api`, Python 3.12+ venv, `pip install -r requirements.txt`):
```
uvicorn main:app --port 8000
```
Needs `WS_TICKET_SECRET`, `CONSOLE_PASSCODE`, `CONSOLE_JWT_SECRET`, `PROFILE_ENC_KEY_V1`, `SUPABASE_URL` (+ `SUPABASE_JWT_SECRET` for HS256), `DATABASE_URL`, provider keys (`LLM_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` / `GOOGLE_APPLICATION_CREDENTIALS_JSON`), `PUBLIC_WS_URL`, `PUBLIC_WEB_URL`, `CORS_ORIGINS`.
Web (from `apps/web`): `npm install && npm run dev` with `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

`J112_ENV` = `dev` | `test` | `prod` (unset = `prod`). `J112_FAKE_PROVIDERS` and `J112_DEV_USER` are ignored outside dev/test, and the API refuses to start (RuntimeError) if either is set while `J112_ENV` is prod; when active it logs a loud warning.

Fake-provider mode (no network, no DB, dev only, never in prod):
```
J112_ENV=dev J112_FAKE_PROVIDERS=1 J112_DEV_USER=<any uuid> CONSOLE_PASSCODE=smoke CONSOLE_JWT_SECRET=<x> WS_TICKET_SECRET=<y> \
PUBLIC_WS_URL=ws://127.0.0.1:8000 uvicorn main:app --port 8000
python tests/smoke_e2e.py      # one full call: answer, opener, card, tap, audio, dispatch, hangup
```
`J112_FAKE_PROVIDERS=1`: STT ignores audio (use console "Ketik ucapan" / `operator_text`), simplifier returns a canned ya/tidak card, TTS streams 0.1 s silence, geocode returns None (`apps/api/fakes.py`). `J112_DEV_USER` makes every request that user and lets `POST /v1/calls` run without a DB.

## Verified
pytest 163 passed; `tsc --noEmit`, `next lint`, `next build` clean; smoke_e2e PASS in fake mode.

## Not verified
Live Deepgram, Gemini Flash/9router, Google TTS, Nominatim, Supabase (auth JWT/JWKS, DB writes, RLS), Web Push; real browsers (mic worklet, audio playback, service worker, iOS SMS links, wake lock); multi-process deploys (sessions, tickets and hubs are in-memory per process).
