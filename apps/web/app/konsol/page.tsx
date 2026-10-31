"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IncidentIcon } from "@/components/icons";
import { paintOf } from "@/lib/incidents";
import { Button } from "@/components/ui/button";
import { ConsoleBar } from "./ConsoleBar";
import type { ServerToConsole } from "@/lib/protocol";
import { closeMessage, consoleRequest, socketUrl, TOKEN_KEY } from "./console";

type Incoming = Extract<ServerToConsole, { type: "incoming_call" }>["data"] & { state?: string };

export default function ConsoleQueue() {
  const [token, setToken] = useState("");
  const [passcode, setPasscode] = useState("");
  const [calls, setCalls] = useState<Incoming[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const rejectSockets = useRef(new Set<WebSocket>());

  useEffect(() => {
    setToken(sessionStorage.getItem(TOKEN_KEY) ?? "");
    const sockets = rejectSockets.current;
    return () => { void audio.current?.close(); sockets.forEach((ws) => ws.close()); };
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let ws: WebSocket;
    try { ws = new WebSocket(socketUrl("/ws/console", token)); }
    catch (e) { setError((e as Error).message); return; }
    ws.onopen = () => {
      setConnected(true);
      // Snapshot and live events share one ordered queue; apply events after the snapshot.
      const pending: ServerToConsole[] = [];
      const apply = (message: ServerToConsole) => {
        if (message.type === "incoming_call") setCalls((old) => [...old.filter((c) => c.call_id !== message.data.call_id), message.data]);
        if (message.type === "call_removed") setCalls((old) => old.filter((c) => c.call_id !== message.data.call_id));
      };
      ws.onmessage = ({ data }) => { try { pending.push(JSON.parse(data) as ServerToConsole); } catch { setError("Pesan antrean tidak valid."); } };
      void consoleRequest<{ calls: Incoming[] }>("/v1/console/calls").then(({ calls: snapshot }) => {
        if (alive) setCalls(snapshot.filter((call) => !call.state || call.state === "MEMANGGIL"));
      }).catch((e: Error) => { if (alive) setError(e.message); }).finally(() => {
        if (!alive) return;
        pending.forEach(apply);
        ws.onmessage = ({ data }) => { try { apply(JSON.parse(data) as ServerToConsole); } catch { setError("Pesan antrean tidak valid."); } };
      });
    };
    ws.onclose = ({ code }) => { if (alive) { setConnected(false); setCalls([]); setError(closeMessage(code)); if (code === 4401) { sessionStorage.removeItem(TOKEN_KEY); setToken(""); } } };
    ws.onerror = () => { if (alive) setError("Antrean tidak dapat tersambung."); };
    return () => { alive = false; ws.close(); };
  }, [token]);

  useEffect(() => {
    if (!calls.length) return;
    const title = document.title;
    let blink = false;
    const ring = () => {
      blink = !blink;
      document.title = blink ? "Panggilan masuk — Jembatan 112" : title;
      const context = audio.current;
      if (!context || context.state !== "running") return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .3);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + .3);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    };
    ring();
    const timer = window.setInterval(ring, 1000);
    return () => { clearInterval(timer); document.title = title; };
  }, [calls.length]);

  async function enableAudio() {
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicReady(true); setError("");
    } catch { setError("Izin mikrofon ditolak. Izinkan mikrofon atau gunakan Ketik ucapan di panel demo."); }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await consoleRequest<{ token: string }>("/v1/console/login", { method: "POST", body: JSON.stringify({ passcode }) });
      if (!result.token) throw new Error("Respons masuk tidak berisi token konsol.");
      sessionStorage.setItem(TOKEN_KEY, result.token); setToken(result.token); setPasscode("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function reject(id: string) {
    try {
      const ws = new WebSocket(socketUrl(`/ws/calls/${encodeURIComponent(id)}/operator`, token));
      rejectSockets.current.add(ws);
      const timeout = window.setTimeout(() => ws.close(), 5000);
      ws.onopen = () => ws.send(JSON.stringify({ type: "reject", data: {} }));
      ws.onmessage = () => ws.close();
      ws.onclose = ({ code }) => { clearTimeout(timeout); rejectSockets.current.delete(ws); if (code >= 4400) setError(closeMessage(code)); };
      ws.onerror = () => setError("Panggilan belum berhasil ditolak.");
    } catch (e) { setError((e as Error).message); }
  }

  const logout = () => { sessionStorage.removeItem(TOKEN_KEY); setToken(""); setCalls([]); };

  return <>
    <ConsoleBar
      connected={token ? connected : null}
      right={token && <>
        <Button variant="outline" className="border-paint/40" onClick={enableAudio}>
          {micReady ? "Mikrofon & dering siap" : "Aktifkan mikrofon & dering"}
        </Button>
        <Button variant="ghost" onClick={logout}>Keluar</Button>
      </>}
    />
    <main className="mx-auto max-w-[1100px] px-6 py-8">
      <p className="mb-6 flex items-center gap-3 rounded-[12px] bg-signal/25 px-4 py-3 text-[16px] font-bold">
        Pakai headset agar suara sistem tidak masuk kembali ke mikrofon.
      </p>
      {error && <p role="alert" className="mb-6 rounded-[12px] bg-signal px-4 py-3 font-bold text-ink">{error}</p>}

      {!token ? (
        <form className="max-w-[440px] space-y-4 rounded-[16px] bg-[var(--panel)] p-6 shadow-[0_8px_24px_rgb(21_23_27/0.08)]" onSubmit={login}>
          <h1 className="text-[30px] leading-9 font-extrabold tracking-[-0.02em]">Masuk konsol</h1>
          <label className="block">
            <span className="text-[16px] font-bold">Sandi konsol</span>
            <input
              type="password" autoComplete="current-password" required value={passcode} onChange={(e) => setPasscode(e.target.value)}
              className="mt-1.5 min-h-14 w-full rounded-[12px] border-[3px] border-[var(--rule)] bg-white px-4 text-[18px] outline-none focus:border-ink"
            />
          </label>
          <Button size="lg" disabled={busy} className="w-full bg-ink text-paint hover:bg-[#2b2f37]">{busy ? "Memeriksa…" : "Masuk"}</Button>
        </form>
      ) : (
        <section aria-labelledby="queue-title">
          <div className="mb-4 flex items-baseline justify-between">
            <h1 id="queue-title" className="text-[30px] leading-9 font-extrabold tracking-[-0.02em]">Panggilan masuk</h1>
            <p className="text-[16px] font-bold text-[var(--ink-muted)]" aria-live="polite">{calls.length} dalam antrean</p>
          </div>
          {!calls.length && (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-[16px] border-[3px] border-dashed border-[#c9c4b8] text-center">
              <p className="text-[22px] font-extrabold">Menunggu panggilan masuk…</p>
              <p className="text-[16px] text-[var(--ink-muted)]">Tahan SOS di ponsel pengguna untuk memulai demo.</p>
            </div>
          )}
          <div className="space-y-3">
            {calls.map((call) => {
              const p = paintOf(call.incident);
              return (
                <article key={call.call_id} className="flex items-center gap-5 overflow-hidden rounded-[16px] bg-[var(--panel)] pr-5 shadow-[0_8px_24px_rgb(21_23_27/0.08)]">
                  <div style={{ background: p.bg, color: p.fg }} className="flex w-56 shrink-0 items-center gap-3 self-stretch p-5">
                    <span className="animate-pulse motion-reduce:animate-none"><IncidentIcon id={call.incident} size={36} /></span>
                    <span className="text-[24px] leading-7 font-extrabold">{p.label}</span>
                  </div>
                  <div className="min-w-0 flex-1 py-4">
                    <p className="text-[18px] font-bold">{call.mode === "latihan" ? "Latihan" : "Simulasi"} · Percobaan {call.attempt}</p>
                    <p className="truncate font-mono text-[14px] text-[var(--ink-muted)]">{call.call_id}</p>
                  </div>
                  <Button asChild size="xl" className="bg-ink text-paint hover:bg-[#2b2f37]">
                    <Link href={`/konsol/${encodeURIComponent(call.call_id)}?incident=${call.incident}&mode=${call.mode}&attempt=${call.attempt}`}>Angkat</Link>
                  </Button>
                  <Button size="xl" variant="outline" className="border-sos text-sos hover:bg-sos/10" onClick={() => reject(call.call_id)}>Tolak</Button>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  </>;
}
