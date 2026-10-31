"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IncidentIcon } from "@/components/icons";
import { INCIDENTS } from "@/lib/incidents";
import { PcmPlayer, startMic, stopMic } from "@/lib/console-audio";
import type { Card, CallState, ConsoleToServer, ForceDegradationData, ServerToConsole } from "@/lib/protocol";
import { closeMessage, consoleRequest, socketUrl, TOKEN_KEY } from "../console";

type Log = Extract<ServerToConsole, { type: "log" }>["data"];
type Sms = Extract<ServerToConsole, { type: "sms_simulated" }>["data"];

function latency(value: number | null) { return value === null ? "—" : `${(value / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} dtk`; }

export default function ConsoleCall() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [state, setState] = useState<CallState>("MEMANGGIL");
  const [incident, setIncident] = useState("umum");
  const [mode, setMode] = useState("");
  const [attempt, setAttempt] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [mulaw, setMulaw] = useState(false);
  const [muted, setMuted] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [logs, setLogs] = useState<Log[]>([]);
  const [card, setCard] = useState<Card | null>(null);
  const [sms, setSms] = useState<Sms[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [forces, setForces] = useState<ForceDegradationData>({ llm: false, stt: false, tts: false });
  const socket = useRef<WebSocket | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  const active = useRef(false);
  const paused = useRef(false);
  const logEnd = useRef<HTMLDivElement | null>(null);
  const alive = useRef(false);

  function send(message: ConsoleToServer) {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError("Sambungan belum siap."); return false; }
    socket.current.send(JSON.stringify(message));
    return true;
  }

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    const query = new URLSearchParams(window.location.search);
    setIncident(query.get("incident") ?? "umum");
    setMode(query.get("mode") ?? "");
    setAttempt(Number(query.get("attempt")) || 1);
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) { router.replace("/konsol"); return; }
    void consoleRequest<{ calls: Extract<ServerToConsole, { type: "incoming_call" }>["data"][] }>("/v1/console/calls").then(({ calls }) => {
      const call = calls.find((item) => item.call_id === id);
      if (!disposed && call) { setIncident(call.incident); setMode(call.mode); setAttempt(call.attempt); }
    }).catch((e: Error) => { if (!disposed) setError(e.message); });
    let ws: WebSocket;
    try { ws = new WebSocket(socketUrl(`/ws/calls/${encodeURIComponent(id)}/operator`, token)); }
    catch (e) { setError((e as Error).message); return; }
    socket.current = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { if (!disposed) setConnected(true); };
    ws.onmessage = ({ data }) => {
      if (disposed) return;
      if (data instanceof ArrayBuffer) {
        player.current?.push(data, () => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "audio_started", data: { client_ts: new Date().toISOString() } }));
        });
        return;
      }
      try {
        const message = JSON.parse(data) as ServerToConsole;
        switch (message.type) {
          case "state":
            setState(message.data.state); setAttempt(message.data.attempt);
            if (message.data.state === "SELESAI") {
              active.current = false; stopMic(); setMicOn(false); setLevel(0); player.current?.close(); player.current = null;
            }
            break;
          case "incoming_call": setIncident(message.data.incident); setMode(message.data.mode); setAttempt(message.data.attempt); break;
          case "log": setLogs((old) => [...old, message.data]); break;
          case "card_preview": setCard(message.data); break;
          case "half_duplex": paused.current = message.data.muted; setMuted(message.data.muted); break;
          case "sms_simulated": setSms((old) => [...old, message.data]); break;
        }
      } catch { setError("Pesan panggilan tidak valid."); }
    };
    ws.onclose = ({ code }) => {
      if (disposed) return;
      active.current = false; stopMic(); player.current?.close(); player.current = null;
      setConnected(false); setMicOn(false); setLevel(0); setError(closeMessage(code));
      if (code === 4401) sessionStorage.removeItem(TOKEN_KEY);
    };
    ws.onerror = () => { if (!disposed) setError("Sambungan panggilan bermasalah."); };
    return () => { disposed = true; alive.current = false; active.current = false; stopMic(); ws.close(); socket.current = null; player.current?.close(); player.current = null; };
  }, [id, router]);

  useEffect(() => {
    if (!answered || state === "SELESAI" || !connected) return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [answered, state, connected]);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "nearest" }); }, [logs]);

  async function microphone() {
    try {
      await startMic(mulaw ? "mulaw_8k" : "pcm16_16k", (frame) => {
        if (active.current && !paused.current && socket.current?.readyState === WebSocket.OPEN) socket.current.send(frame);
      }, (value) => { if (alive.current) setLevel(value); });
      if (alive.current && active.current) setMicOn(true);
    } catch { if (alive.current) setError("Mikrofon tidak tersedia. Izinkan akses lalu coba lagi, atau gunakan Ketik ucapan (debug)."); }
  }

  async function answer() {
    if (answering || answered) return;
    setAnswering(true); setError("");
    try {
      player.current ??= new PcmPlayer();
      await player.current.resume();
      if (!alive.current) return;
      if (!send({ type: "answer", data: { codec: mulaw ? "mulaw_8k" : "pcm16_16k" } })) return;
      active.current = true; setAnswered(true);
      await microphone();
    } catch { setError("Audio belum dapat diaktifkan. Coba Angkat kembali."); }
    finally { if (alive.current) setAnswering(false); }
  }

  const live = connected && answered && state !== "SELESAI";
  const demo = mode === "latihan" || mode === "simulasi";
  return <main>
    <Link href="/konsol">← Antrean panggilan</Link>
    <h1>Konsol operator · {id.slice(0, 8)}</h1>
    {error && <p role="alert" className="console-warning">{error}</p>}
    <div className="console-grid">
      <section className="console-panel">
        <h2>Panggilan</h2>
        <p role="status"><span className="console-badge">{state}</span> · {connected ? "Tersambung" : "Terputus"}</p>
        <p aria-label="Durasi panggilan">{Math.floor(seconds / 60).toString().padStart(2, "0")}:{(seconds % 60).toString().padStart(2, "0")}</p>
        <IncidentIcon id={incident} /><h3>{INCIDENTS.find((i) => i.id === incident)?.label ?? "Darurat"}</h3>
        <p>{mode || "Mode belum tersedia"} · Percobaan {attempt}</p>
        <div className="console-stack">
          <button className="primary" disabled={!connected || answered || answering || state === "SELESAI"} onClick={answer}>{answering ? "Mengaktifkan audio…" : "Angkat"}</button>
          <button disabled={!connected || answered || state === "SELESAI"} onClick={() => { if (send({ type: "reject", data: {} })) router.push("/konsol"); }}>Tolak</button>
          <button className="primary" disabled={!live} onClick={() => send({ type: "dispatch", data: {} })}>Petugas dikirim</button>
          <button className="danger" disabled={!live} onClick={() => { if (send({ type: "hangup", data: {} })) { active.current = false; stopMic(); router.push("/konsol"); } }}>Tutup panggilan</button>
        </div>
        <p className="console-meta">Pakai headset. Satu konsol menangani satu panggilan aktif.</p>
      </section>
      <section className="console-panel">
        <h2>Percakapan</h2>
        <div className="console-log" role="log" aria-label="Log percakapan" aria-live="polite">
          {!logs.length && <p className="console-meta">Percakapan akan muncul setelah panggilan diangkat.</p>}
          {logs.map((log, index) => <article className={`console-bubble ${log.who === "operator" ? "operator" : ""}`} key={index}>
            <strong>{log.who === "operator" ? "Operator" : "Sistem"}</strong><p>{log.text}</p>
            <span className="console-meta">Putaran {log.turn_no}</span><span className="console-badge">A {latency(log.latency_a_ms)}</span><span className="console-badge">B {latency(log.latency_b_ms)}</span>
          </article>)}<div ref={logEnd} />
        </div>
        {card && <section className="console-card" aria-label="Pratinjau kartu pengguna">
          <h3>Kartu pengguna · {card.kind}</h3><p>{card.question}</p>
          {card.options.map((option, index) => <div key={index}><span className="console-badge">{option.label}</span><small>{option.spoken}</small></div>)}
          <p className="console-meta">{card.transcript} · Degradasi L{card.degradation}</p>
        </section>}
        <button style={{ width: "100%", marginTop: 16 }} disabled={!live || muted} onClick={() => {
          if (micOn) { stopMic(); setMicOn(false); setLevel(0); } else void microphone();
        }}>{muted ? "Sistem bicara, mikrofon dijeda" : micOn ? "Mikrofon aktif" : "Aktifkan mikrofon"}</button>
      </section>
      <aside className="console-panel">
        <h2>Panel demo</h2>
        <label><input type="checkbox" checked={mulaw} disabled={answered || answering} onChange={(e) => setMulaw(e.target.checked)} />Simulasi kodek 8 kHz</label>
        <p className="console-meta">Kodek dikunci setelah Angkat.</p>
        <fieldset disabled={!connected || !demo || state === "SELESAI"}>
          <legend>Simulasi kegagalan</legend>
          {([ ["llm", "Paksa LLM gagal (L1)"], ["stt", "Paksa STT gagal (L2)"], ["tts", "Paksa TTS gagal (L3)"] ] as const).map(([key, label]) => <label key={key}>
            <input type="checkbox" checked={forces[key]} onChange={(e) => { const next = { ...forces, [key]: e.target.checked }; if (send({ type: "force_degradation", data: next })) setForces(next); }} />{label}
          </label>)}
        </fieldset>
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim() && send({ type: "operator_text", data: { text: text.trim() } })) setText(""); }}>
          <label htmlFor="operator-text">Ketik ucapan (debug)</label><textarea id="operator-text" rows={3} required value={text} onChange={(e) => setText(e.target.value)} />
          <button disabled={!live || !text.trim()}>Kirim ucapan</button>
        </form>
        <h3>Level mikrofon</h3><meter aria-label="Level mikrofon" min={0} max={1} value={level} /><p className="console-meta">{muted ? "Bingkai mikrofon dijeda" : micOn ? "Mikrofon merekam" : "Mikrofon mati"}</p>
        <h3>SMS simulasi</h3><div aria-live="polite">{!sms.length && <p className="console-meta">Belum ada SMS simulasi.</p>}{sms.map((message, index) => <article className="console-card" key={index}><strong>{message.to}</strong><p>{message.text}</p></article>)}</div>
      </aside>
    </div>
  </main>;
}
