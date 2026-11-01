"use client";
import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { GpsIcon, IncidentIcon } from "@/components/icons";
import { RouteBoard, type Stop } from "@/components/RouteBoard";
import { INCIDENTS, paintOf } from "@/lib/incidents";

interface ActiveCall {
  incident: string;
  state: string;
  location?: { lat: number; lng: number; accuracy_m: number; maps_url: string } | null;
  sos_confirmed_at?: string | null;
  dispatched_at?: string | null;
  ended_at?: string | null;
}
interface Summary { user_display_name: string; active_call: ActiveCall | null; ws_url: string }

function statusText(c: ActiveCall, name: string): string {
  if (c.ended_at || c.state === "SELESAI") return "Selesai";
  if (c.state === "FALLBACK") return `Panggilan gagal: hubungi ${name} atau 112`;
  if (c.dispatched_at) return "Petugas berangkat";
  if (c.state === "SIAGA" || c.state === "MEMANGGIL") return "Memanggil 112";
  return "Tersambung";
}

// The same route the user sees, from the fields this page already receives.
function stopsOf(c: ActiveCall): Stop[] {
  const connected = !["SIAGA", "MEMANGGIL", "FALLBACK"].includes(c.state) || !!c.dispatched_at;
  const over = !!c.ended_at || c.state === "SELESAI";
  return [
    { label: connected ? "Tersambung ke 112" : "Memanggil 112", state: connected || over ? "done" : "current" },
    { label: "Operator bertanya", state: c.dispatched_at || over ? "done" : connected ? "current" : "todo" },
    { label: "Petugas berangkat", state: c.dispatched_at ? "done" : "todo" },
  ];
}

function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  return m < 1 ? "baru saja" : m < 60 ? `${m} menit lalu` : `${Math.floor(m / 60)} jam lalu`;
}

function b64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

export default function KontakPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  const [push, setPush] = useState("");
  const [ios, setIos] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches);
    let ws: WebSocket | undefined;
    let closed = false;
    let callId: string | null = null; // call the page currently shows; a different id => new emergency
    let opened = false;
    const load = () =>
      api<Summary>(`/v1/contact/${encodeURIComponent(token)}`).then((d) => {
        if (!closed) setData(d);
        return d;
      });
    load()
      .then((d) => {
        if (closed || !d.ws_url) return;
        ws = new WebSocket(d.ws_url);
        ws.onopen = () => {
          if (opened) load().catch(() => {}); // reconnect: we may have missed updates
          opened = true;
        };
        ws.onmessage = (ev) => {
          let m: { type?: string; data?: Record<string, unknown> };
          try { m = JSON.parse(ev.data as string); } catch { return; }
          const x = m.data ?? {};
          const id = typeof x.call_id === "string" ? x.call_id : null;
          const fresh = id !== null && callId !== null && id !== callId;
          if (id) callId = id;
          if (fresh || (m.type === "state" && (x.state === "SIAGA" || x.state === "MEMANGGIL"))) {
            load().catch(() => {});
            return;
          }
          setData((cur) => {
            if (!cur) return cur;
            const now = new Date().toISOString();
            const base: ActiveCall = cur.active_call ?? { incident: "umum", state: "SIAGA" };
            if (m.type === "state") return { ...cur, active_call: { ...base, state: String(x.state ?? base.state) } };
            if (m.type === "dispatch") return { ...cur, active_call: { ...base, dispatched_at: now } };
            if (m.type === "fallback") return { ...cur, active_call: { ...base, state: "FALLBACK" } };
            if (m.type === "ended") return { ...cur, active_call: { ...base, state: "SELESAI", ended_at: now } };
            return cur;
          });
        };
      })
      .catch(() => setErr("Tautan tidak valid atau sudah diganti."));
    return () => {
      closed = true;
      ws?.close();
    };
  }, [token]);

  async function enablePush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setPush("Peramban ini belum mendukung notifikasi.");
      if ((await Notification.requestPermission()) !== "granted") return setPush("Izin notifikasi ditolak.");
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api<{ key?: string; public_key?: string }>("/v1/push/vapid-public-key").then((d) => ({ key: d.key ?? d.public_key }));
      if (!key) return setPush("Notifikasi belum tersedia.");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await api(`/v1/contact/${encodeURIComponent(token)}/push`, { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
      setPush("Notifikasi aktif.");
    } catch {
      setPush("Gagal mengaktifkan notifikasi.");
    }
  }

  const c = data?.active_call;
  const inc = INCIDENTS.find((i) => i.id === c?.incident);
  const name = data?.user_display_name ?? "";
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] px-2 text-[var(--color-text)]">
      <div className="s-bar">
        <span className="s-word">J112</span>
        <span className="m-label !mb-0">Status keluarga</span>
      </div>
      <div className="grid gap-2 pb-24">
        {err && <p role="alert" className="s-panel m-surface font-semibold text-[var(--color-sos)]">{err}</p>}
        {data && !c && <p className="s-panel m-surface text-lg">Belum ada kejadian dari {name}.</p>}
        {c && (
          <section aria-live="polite" className="grid gap-2">
            <div className="s-panel flex items-center gap-4" style={{ background: paintOf(inc?.id).bg, color: paintOf(inc?.id).fg }}>
              <IncidentIcon id={inc?.id ?? "umum"} size={44} />
              <div>
                <p className="s-display text-[34px] leading-9 font-black tracking-[-0.03em]">{inc?.label ?? "Darurat"}</p>
                <p className="font-semibold">{name} meminta bantuan</p>
              </div>
            </div>
            <div className="s-panel m-surface space-y-4" style={{ "--i": 1 } as React.CSSProperties}>
              {c.sos_confirmed_at && (
                <p className="m-label">
                  SOS {new Date(c.sos_confirmed_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} · {ago(c.sos_confirmed_at, now)}
                </p>
              )}
              <p className={`s-h2 ${c.state === "FALLBACK" ? "text-[color:var(--color-sos)]" : ""}`}>{statusText(c, name)}</p>
              {c.state !== "FALLBACK" && <RouteBoard stops={stopsOf(c)} paint={paintOf(inc?.id)} />}
            </div>
            {c.location && (
              <a href={c.location.maps_url} target="_blank" rel="noreferrer" className="m-btn w-full">
                <GpsIcon size={22} />
                Buka lokasi di peta
                <span className="text-[15px] font-normal opacity-80">±{Math.round(c.location.accuracy_m)} m</span>
              </a>
            )}
            <a href="tel:112" className="m-btn m-btn--sos w-full">Telepon 112</a>
          </section>
        )}
        {data && (
          <section className="s-panel m-surface space-y-3" style={{ "--i": 2 } as React.CSSProperties}>
            {ios && <p className="font-semibold text-[var(--color-warning)]">Tambahkan ke Layar Utama agar notifikasi bisa muncul.</p>}
            <button onClick={enablePush} className="m-btn m-btn--line w-full">Izinkan notifikasi</button>
            {push && <p role="status">{push}</p>}
          </section>
        )}
      </div>
    </main>
  );
}
