import type { ServerToUser, UserToServer } from "./protocol";

type Msg = ServerToUser;
export type SocketStatus = "open" | "reconnecting" | "closed";

const ACK_TYPES = new Set(["card", "dispatch", "fallback", "ended"]);
const STAMPED = new Set(["tap", "gps", "text", "repeat", "card_shown"]);
const FATAL = new Set([4404, 4409, 4410]);
const BACKOFF_MS = [500, 1000, 2000, 4000];

/**
 * Call channel: JSON envelope, seq tracking + auto-ack, resume on (re)connect, backoff 0.5/1/2/4 s, ping 10 s.
 * TODO(integrator): tickets are single-use (60 s). Pass `getTicket` to fetch a fresh one on reconnect;
 * without it the old ticket is retried (works only if the server tolerates reuse).
 */
export class CallSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(m: Msg) => void>>();
  private statusHandlers = new Set<(s: SocketStatus, code?: number) => void>();
  private lastSeq = 0;
  private tries = 0;
  private everOpen = false;
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
    ws.onopen = () => {
      this.tries = 0;
      this.everOpen = true;
      this.emit("open");
      this.raw({ v: 1, type: "resume", data: { last_seq: this.lastSeq } });
      this.outbox.splice(0).forEach((s) => ws.send(s));
      this.pingTimer = setInterval(
        () => this.raw({ v: 1, type: "ping", data: { client_ts: new Date().toISOString() } }),
        10_000,
      );
    };
    ws.onmessage = (ev) => {
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
      // 4401 is final only on the very first connect (bad ticket); later it may just be ticket reuse.
      if (FATAL.has(ev.code) || (ev.code === 4401 && !this.everOpen)) {
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
