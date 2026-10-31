"""asyncpg pool + non-blocking event log writer (TRD 5.1). No DATABASE_URL = no-DB mode."""
import asyncio
import json
import os
import re
import sys
from uuid import UUID

import asyncpg

_pool: asyncpg.Pool | None = None
_queue: asyncio.Queue | None = None
_writer: asyncio.Task | None = None
_warned = False
db_log_dropped = 0
_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


def enabled() -> bool:
    return _pool is not None


def _nodb() -> None:
    global _warned
    if not _warned:
        _warned = True
        print("db: no DATABASE_URL / pool, running in no-DB mode", file=sys.stderr)


async def init_pool() -> None:
    global _pool, _queue, _writer
    url = os.environ.get("DATABASE_URL")
    if not url:
        _nodb()
        return
    try:
        _pool = await asyncpg.create_pool(url, min_size=1, max_size=5, statement_cache_size=0)
    except (OSError, asyncpg.PostgresError) as e:
        import auth
        if auth.dev_mode():
            print(f"db: could not connect to {url} ({e}), running in no-DB mode", file=sys.stderr)
            _nodb()
            return
        raise
    _queue = asyncio.Queue(maxsize=1000)
    _writer = asyncio.create_task(_drain())


async def close_pool() -> None:
    global _pool, _writer
    if _writer:
        _writer.cancel()
        _writer = None
    if _pool:
        await _pool.close()
        _pool = None


async def fetch_one(sql: str, *args) -> dict | None:
    if not _pool:
        _nodb()
        return None
    row = await _pool.fetchrow(sql, *args)
    return dict(row) if row else None


async def fetch_all(sql: str, *args) -> list[dict]:
    if not _pool:
        _nodb()
        return []
    return [dict(r) for r in await _pool.fetch(sql, *args)]


async def execute(sql: str, *args) -> None:
    if not _pool:
        _nodb()
        return None
    await _pool.execute(sql, *args)


def _cols(fields: dict) -> list[str]:
    for k in fields:
        if not _IDENT.match(k):
            raise ValueError(f"bad column name: {k!r}")
    return list(fields)


def _insert_sql(table: str, cols: list[str]) -> str:
    ph = ", ".join(f"${i + 1}" for i in range(len(cols)))
    return f"insert into public.{table} ({', '.join(cols)}) values ({ph})"


async def insert_call(**fields) -> UUID | None:
    if not _pool:
        _nodb()
        return None
    return await _pool.fetchval(_insert_sql("calls", _cols(fields)) + " returning id", *fields.values())


async def update_call(call_id, **fields) -> None:
    if not _pool:
        _nodb()
        return None
    if not fields:
        return None
    sets = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(_cols(fields)))
    await _pool.execute(f"update public.calls set {sets} where id = $1", call_id, *fields.values())


async def upsert_turn(**fields) -> None:
    """Keyed by card_id (unique)."""
    if not _pool:
        _nodb()
        return None
    cols = _cols(fields)
    upd = ", ".join(f"{c} = excluded.{c}" for c in cols if c != "card_id")
    tail = f"update set {upd}" if upd else "nothing"
    await _pool.execute(f"{_insert_sql('call_turns', cols)} on conflict (card_id) do {tail}", *fields.values())


def log_event(call_id, seq, event, from_state, to_state, ignored=False, payload=None) -> None:
    global db_log_dropped
    row = (call_id, seq, event, str(from_state) if from_state else None,
           str(to_state) if to_state else None, ignored, payload or {})
    if _queue is None:
        return  # no-DB mode
    try:
        _queue.put_nowait(row)
    except asyncio.QueueFull:
        db_log_dropped += 1
        print(json.dumps({"db_log_dropped": db_log_dropped, "call_id": str(call_id), "seq": seq,
                          "event": event, "from": row[3], "to": row[4], "ignored": ignored}), flush=True)


async def _drain() -> None:
    while True:
        cid, seq, ev, fs, ts, ign, payload = await _queue.get()
        try:
            await _pool.execute(
                "insert into public.call_events (call_id, seq, event, from_state, to_state, ignored, payload) "
                "values ($1,$2,$3,$4::public.call_state,$5::public.call_state,$6,$7::jsonb) "
                "on conflict (call_id, seq) do nothing",
                cid, seq, ev, fs, ts, ign, json.dumps(payload))
        except Exception as e:  # never kill the writer
            print(f"db: event write failed: {type(e).__name__}", file=sys.stderr)
