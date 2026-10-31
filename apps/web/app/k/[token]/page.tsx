"use client";
import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { IncidentIcon } from "@/components/icons";
import { INCIDENTS } from "@/lib/incidents";

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
    <main className="mx-auto min-h-dvh max-w-md space-y-4 p-6 text-[var(--color-text)]">
      <h1 className="text-2xl font-bold">Jembatan 112</h1>
      <p role="alert" className="text-[var(--color-sos)]">{err}</p>
      {data && !c && <p className="text-lg">Belum ada kejadian dari {name}.</p>}
      {c && (
        <section aria-live="polite" className="space-y-3">
          <div
            className="flex items-center gap-4 rounded-2xl p-5 text-white"
            style={{ background: `var(${inc?.colorVar ?? "--color-navy"})` }}
          >
            <IncidentIcon id={inc?.id ?? "umum"} size={40} />
            <div>
              <p className="text-2xl font-bold">{inc?.label ?? "Darurat"}</p>
              <p>{name} meminta bantuan</p>
            </div>
          </div>
          {c.sos_confirmed_at && <p className="text-[var(--color-text-muted)]">{new Date(c.sos_confirmed_at).toLocaleTimeString("id-ID")}</p>}
          <p className="text-xl font-bold">{statusText(c, name)}</p>
          {c.location && (
            <p>
              {c.location.lat.toFixed(5)}, {c.location.lng.toFixed(5)}{" "}
              <a href={c.location.maps_url} target="_blank" rel="noreferrer" className="font-bold underline text-[var(--color-accent)]">Buka di peta</a>
            </p>
          )}
          <a href="tel:112" className="flex min-h-14 items-center justify-center rounded-xl bg-[var(--color-sos)] text-lg font-bold text-white">Telepon 112</a>
        </section>
      )}
      {data && (
        <section className="space-y-2 rounded-xl bg-[var(--color-surface)] p-4">
          {ios && <p className="text-[var(--color-warning)]">Tambahkan ke Layar Utama agar notifikasi bisa muncul.</p>}
          <button onClick={enablePush} className="min-h-12 w-full rounded-xl border-2 border-[var(--color-primary)] font-bold text-[var(--color-accent)]">Izinkan notifikasi</button>
          <p role="status">{push}</p>
        </section>
      )}
    </main>
  );
}
