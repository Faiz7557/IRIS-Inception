"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IncidentIcon } from "@/components/icons";
import { INCIDENTS } from "@/lib/incidents";
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

  return <main>
    <h1>Jembatan 112 · Konsol operator</h1>
    <p className="console-warning">Pakai headset untuk mencegah suara sistem masuk kembali ke mikrofon. Konsol ini untuk simulasi.</p>
    {error && <p role="alert">{error}</p>}
    {!token ? <form className="console-panel" style={{ maxWidth: 480 }} onSubmit={login}>
      <h2>Masuk konsol</h2><label>Sandi konsol<input type="password" autoComplete="current-password" required value={passcode} onChange={(e) => setPasscode(e.target.value)} /></label>
      <button className="primary" disabled={busy}>{busy ? "Memeriksa…" : "Masuk"}</button>
    </form> : <>
      <div className="console-stack"><button onClick={enableAudio}>{micReady ? "Mikrofon dan bunyi dering siap" : "Aktifkan mikrofon dan bunyi dering"}</button>
        <p role="status">{connected ? "Antrean tersambung" : "Antrean belum tersambung"} · {calls.length} panggilan</p></div>
      <div className="console-stack">{calls.map((call) => <article className="console-panel" key={call.call_id}>
        <h2><IncidentIcon id={call.incident} size={24} /> {INCIDENTS.find((i) => i.id === call.incident)?.label ?? "Darurat"}</h2>
        <p>{call.mode} · Percobaan {call.attempt} · <span className="console-meta">{call.call_id}</span></p>
        <Link className="console-button primary" href={`/konsol/${encodeURIComponent(call.call_id)}?incident=${call.incident}&mode=${call.mode}&attempt=${call.attempt}`}>Angkat</Link>{" "}
        <button className="danger" onClick={() => reject(call.call_id)}>Tolak</button>
      </article>)}</div>
      {!calls.length && <p>Menunggu panggilan masuk…</p>}
      <button onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(""); setCalls([]); }}>Keluar</button>
    </>}
  </main>;
}
