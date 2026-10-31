import type { ServerToUser, UserToServer } from "./protocol";

type Msg = ServerToUser;
export type SocketStatus = "open" | "reconnecting" | "closed";

const ACK_TYPES = new Set(["card", "dispatch", "fallback", "ended"]);
const STAMPED = new Set(["tap", "gps", "text", "repeat", "card_shown"]);
const FATAL = new Set([4404, 4409, 4410]);
const MAX_TICKET_REFRESH = 2; // 4401 retries with a fresh ticket before giving up
const BACKOFF_MS = [500, 1000, 2000, 4000];

/**
 * Call channel: JSON envelope, seq tracking + auto-ack, resume on (re)connect, backoff 0.5/1/2/4 s, ping 10 s.
 * Tickets are single-use (60 s): `getTicket` (POST /v1/calls/{id}/ticket) fetches a fresh one before every
 * reconnect. A socket counts as authenticated only after the first server message (onopen precedes ticket
 * validation); repeated 4401 closes stop after MAX_TICKET_REFRESH refreshes with a terminal "closed" 4401.
 */
export class CallSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(m: Msg) => void>>();
  private statusHandlers = new Set<(s: SocketStatus, code?: number) => void>();
  private lastSeq = 0;
  private tries = 0;
  private authFails = 0;
  private stopped = false;
  private outbox: string[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url: string,
    private ticket: string,
    private getTicket?: () => Promise<string | null>,
  ) {
    this.connect();
  }

  on<T extends Msg["type"]>(type: T, handler: (m: Extract<Msg, { type: T }>) => void): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as (m: Msg) => void);
    this.handlers.set(type, set);
    return () => set.delete(handler as (m: Msg) => void);
  }

  onStatus(h: (s: SocketStatus, code?: number) => void): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  send<T extends UserToServer["type"]>(
    type: T,
    data: Omit<Extract<UserToServer, { type: T }>["data"], "client_ts"> & { client_ts?: string },
  ) {
    const d: Record<string, unknown> = { ...data };
    if (STAMPED.has(type) && !d.client_ts) d.client_ts = new Date().toISOString();
    this.raw({ v: 1, type, data: d }, true);
  }

  close() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close(1000);
    this.emit("closed");
  }

  private raw(obj: unknown, queue = false) {
    const s = JSON.stringify(obj);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (queue) this.outbox.push(s);
  }

  private emit(s: SocketStatus, code?: number) {
    this.statusHandlers.forEach((h) => h(s, code));
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pingTimer = this.retryTimer = null;
  }

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(`${this.url}?ticket=${encodeURIComponent(this.ticket)}`);
    this.ws = ws;
    let authed = false;
    ws.onopen = () => {
      this.raw({ v: 1, type: "ping", data: { client_ts: new Date().toISOString() } }); // first reply proves the ticket
      this.raw({ v: 1, type: "resume", data: { last_seq: this.lastSeq } });
      this.pingTimer = setInterval(
        () => this.raw({ v: 1, type: "ping", data: { client_ts: new Date().toISOString() } }),
        10_000,
      );
    };
    ws.onmessage = (ev) => {
      if (!authed) {
        authed = true;
        this.tries = this.authFails = 0;
        this.emit("open");
        this.outbox.splice(0).forEach((s) => ws.send(s));
      }
      let m: Msg;
      try {
        m = JSON.parse(String(ev.data)) as Msg;
      } catch {
        return;
      }
      if (typeof m.seq === "number" && m.seq > 0) {
        if (ACK_TYPES.has(m.type)) this.raw({ v: 1, type: "ack", data: { seq: m.seq } });
        if (m.seq <= this.lastSeq) return; // resent duplicate
        this.lastSeq = m.seq;
      }
      this.handlers.get(m.type)?.forEach((h) => h(m));
    };
    ws.onclose = (ev) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.stopped) return;
      if (ev.code === 4401 && !authed) this.authFails++;
      if (FATAL.has(ev.code) || (ev.code === 4401 && (!this.getTicket || this.authFails > MAX_TICKET_REFRESH))) {
        this.stopped = true;
        this.emit("closed", ev.code);
        return;
      }
      this.emit("reconnecting");
      const wait = BACKOFF_MS[Math.min(this.tries++, BACKOFF_MS.length - 1)];
      this.retryTimer = setTimeout(async () => {
        if (this.getTicket) this.ticket = (await this.getTicket()) ?? this.ticket;
        this.connect();
      }, wait);
    };
  }
}
