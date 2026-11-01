"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IncidentIcon } from "@/components/icons";
import { paintOf } from "@/lib/incidents";
import { Button } from "@/components/ui/button";
import { RouteBoard, type Stop } from "@/components/RouteBoard";
import { ConsoleBar } from "../ConsoleBar";
import { PcmPlayer, startMic, stopMic } from "@/lib/console-audio";
import type { Card, CallState, ConsoleToServer, ForceDegradationData, ServerToConsole } from "@/lib/protocol";
import { closeMessage, consoleRequest, socketUrl, TOKEN_KEY } from "../console";

type Log = Extract<ServerToConsole, { type: "log" }>["data"];
type Sms = Extract<ServerToConsole, { type: "sms_simulated" }>["data"];

function latency(value: number | null) { return value === null ? "—" : `${(value / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} dtk`; }
function median(xs: number[]) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

const QA_STATES: CallState[] = ["MENDENGAR", "MENYEDERHANAKAN", "MENUNGGU_JAWABAN", "MEMBACAKAN"];

// One-click operator lines for the demo: the usual questions per incident, sent as operator_text.
const QUICK: Record<string, string[]> = {
  kebakaran: ["Apakah api masih menyala?", "Ada orang terjebak di dalam?"],
  kecelakaan: ["Berapa orang terluka?", "Apakah korban sadar?"],
  sakit: ["Apakah pasien sadar?", "Apakah pasien masih bernapas?"],
  kejahatan: ["Apakah pelaku masih di sana?", "Apakah pelaku membawa senjata?"],
  kdrt: ["Apakah pelaku masih di dekat Anda?", "Bisakah Anda pindah ke tempat aman?"],
  bencana: ["Bencana apa yang terjadi?", "Ada orang tertimbun?"],
};
const QUICK_COMMON = ["Di mana lokasi Anda sekarang?", "Ada yang terluka?", "Tetap di tempat, petugas sedang menuju lokasi."];

/** One latency readout: last value large, median and the paper's target beneath, coloured against the target. */
function Readout({ name, what, values, target, warn }: { name: string; what: string; values: number[]; target: number; warn: number }) {
  const last = values.length ? values[values.length - 1] : null;
  const med = median(values);
  const tone = last === null ? "text-[var(--ink-muted)]" : last <= target ? "text-[var(--done-paper)]" : last <= warn ? "text-[var(--amber-paper)]" : "text-sos";
  return (
    <div className="flex-1 rounded-[14px] bg-[var(--panel)] p-4 shadow-[0_8px_24px_rgb(21_23_27/0.06)]">
      <p className="text-[15px] font-extrabold tracking-[0.04em]">LATENSI {name}</p>
      <p className="text-[14px] leading-5 text-[var(--ink-muted)]">{what}</p>
      <p className={`mt-2 font-mono text-[44px] leading-[48px] font-bold tabular-nums ${tone}`}>{latency(last)}</p>
      <p className="mt-1 text-[14px] font-bold text-[var(--ink-muted)]">
        median {latency(med)} · target ≤ {latency(target)} · {values.length} putaran
      </p>
    </div>
  );
}

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
  const [dispatched, setDispatched] = useState(false);
  const [confirmHang, setConfirmHang] = useState(false);
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
  const paint = paintOf(incident);
  const latA = logs.flatMap((l) => (l.latency_a_ms === null ? [] : [l.latency_a_ms]));
  const latB = logs.flatMap((l) => (l.latency_b_ms === null ? [] : [l.latency_b_ms]));
  const turns = new Set(logs.filter((l) => l.who === "operator").map((l) => l.turn_no)).size;
  const openerDone = answered && state !== "MEMANGGIL" && state !== "PEMBUKA";
  const stops: Stop[] = [
    { label: answered ? "Diangkat" : "Panggilan masuk", sub: !answered && attempt > 1 ? `Percobaan ${attempt}` : undefined, state: answered ? "done" : "current" },
    { label: "Pesan pembuka dibacakan", state: !answered ? "todo" : openerDone ? "done" : "current" },
    {
      label: "Tanya jawab", sub: turns ? `${turns} putaran` : undefined,
      state: !openerDone ? "todo" : dispatched || state === "SELESAI" ? "done" : QA_STATES.includes(state) ? "current" : "todo",
    },
    { label: "Petugas dikirim", state: dispatched ? "done" : "todo" },
  ];
  const sendText = () => { if (text.trim() && send({ type: "operator_text", data: { text: text.trim() } })) setText(""); };
  const sendQuick = (line: string) => send({ type: "operator_text", data: { text: line } });
  // Hang-up ends the call for good: the first click arms it for 4 s, the second one hangs up.
  const hangup = () => {
    if (!confirmHang) {
      setConfirmHang(true);
      window.setTimeout(() => setConfirmHang(false), 4000);
      return;
    }
    if (send({ type: "hangup", data: {} })) { active.current = false; stopMic(); router.push("/konsol"); }
  };
  const clock = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const panel = "rounded-[16px] bg-[var(--panel)] shadow-[0_8px_24px_rgb(21_23_27/0.06)]";
  const inkBtn = "bg-ink text-paint hover:bg-[#2b2f37]";
  const inkOutline = "border-ink/40 text-ink hover:bg-[var(--rule)]";

  return <>
    <ConsoleBar connected={connected} right={<Button asChild variant="ghost"><Link href="/konsol">← Antrean</Link></Button>} />
    <main className="mx-auto grid max-w-[1600px] grid-cols-[340px_minmax(0,1fr)_380px] gap-5 px-6 py-5 max-[1180px]:grid-cols-[300px_minmax(0,1fr)] max-[860px]:grid-cols-1">
      {error && <p role="alert" className="col-span-full rounded-[12px] bg-signal px-4 py-3 font-bold text-ink">{error}</p>}

      <section aria-label="Panggilan" className="space-y-4">
        <div style={{ background: paint.bg, color: paint.fg }} className="rounded-[16px] p-5">
          <div className="flex items-center gap-3">
            <IncidentIcon id={incident} size={34} />
            <h1 className="text-[26px] leading-8 font-extrabold tracking-[-0.01em]">{paint.label}</h1>
          </div>
          <p className="mt-3 font-mono text-[40px] leading-[44px] font-bold tabular-nums" aria-label="Durasi panggilan">{clock}</p>
          <p className="mt-1 text-[15px] font-bold opacity-85">{mode === "latihan" ? "Latihan" : mode === "simulasi" ? "Simulasi" : "Mode belum tersedia"} · {id.slice(0, 8)}</p>
        </div>
        <div className={`${panel} p-5`}>
          <RouteBoard stops={stops} paint={paint} tone="light" />
          <p className="-mt-2 font-mono text-[13px] text-[var(--ink-muted)]" role="status">Status mesin: {state}</p>
        </div>
        <div className="space-y-2.5">
          {!answered && (
            <Button size="xl" className={`w-full ${inkBtn}`} disabled={!connected || answering || state === "SELESAI"} onClick={answer}>
              {answering ? "Mengaktifkan audio…" : "Angkat"}
            </Button>
          )}
          <Button size="xl" className="w-full bg-[var(--done-paper)] text-white hover:bg-[#178244]" disabled={!live || dispatched} onClick={() => { if (send({ type: "dispatch", data: {} })) setDispatched(true); }}>
            {dispatched ? "Petugas sudah dikirim" : "Petugas dikirim"}
          </Button>
          <Button size="lg" variant="sos" className="w-full" disabled={!live} onClick={hangup} aria-live="polite">
            {confirmHang ? "Klik lagi untuk menutup" : "Tutup panggilan"}
          </Button>
          {!answered && (
            <Button size="lg" variant="outline" className={`w-full ${inkOutline}`} disabled={!connected || state === "SELESAI"} onClick={() => { if (send({ type: "reject", data: {} })) router.push("/konsol"); }}>
              Tolak
            </Button>
          )}
        </div>
      </section>

      <section aria-label="Percakapan" className="flex min-w-0 flex-col gap-4">
        <div className="flex gap-4">
          <Readout name="A" what="Operator selesai bicara → tombol muncul" values={latA} target={3000} warn={4500} />
          <Readout name="B" what="Pengguna mengetuk → operator mendengar" values={latB} target={1000} warn={1500} />
        </div>
        <div className={`flex min-h-0 flex-1 flex-col ${panel}`}>
          <h2 className="border-b-2 border-[var(--rule)] px-5 py-3 text-[18px] font-extrabold">Percakapan</h2>
          <div className="console-scroll flex h-[44vh] flex-col gap-3 overflow-auto p-5" role="log" aria-label="Log percakapan" aria-live="polite">
            {!logs.length && <p className="m-auto text-[16px] text-[var(--ink-muted)]">Percakapan muncul setelah panggilan diangkat.</p>}
            {logs.map((log, index) => {
              const op = log.who === "operator";
              return (
                <article key={index} className={`max-w-[82%] rounded-[14px] px-4 py-3 ${op ? "self-end bg-ink text-paint" : "self-start bg-[var(--paper)]"}`}>
                  <p className={`text-[13px] font-extrabold tracking-[0.04em] ${op ? "text-paint-muted" : "text-[var(--ink-muted)]"}`}>{op ? "OPERATOR" : "SISTEM"} · PUTARAN {log.turn_no}</p>
                  <p className="mt-1 text-[17px] leading-6">{log.text}</p>
                  {(log.latency_a_ms !== null || log.latency_b_ms !== null) && (
                    <p className={`mt-1.5 font-mono text-[13px] tabular-nums ${op ? "text-paint-muted" : "text-[var(--ink-muted)]"}`}>
                      {[log.latency_a_ms !== null ? `A ${latency(log.latency_a_ms)}` : null, log.latency_b_ms !== null ? `B ${latency(log.latency_b_ms)}` : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </article>
              );
            })}
            <div ref={logEnd} />
          </div>
          <div className="flex flex-wrap gap-2 border-t-2 border-[var(--rule)] px-4 pt-3" aria-label="Pertanyaan cepat">
            {[...(QUICK[incident] ?? []), ...QUICK_COMMON].map((line) => (
              <button
                key={line}
                type="button"
                disabled={!live}
                onClick={() => sendQuick(line)}
                className="min-h-10 rounded-full border-2 border-[var(--rule)] bg-white px-3.5 text-[15px] font-bold hover:border-ink disabled:opacity-40"
              >
                {line}
              </button>
            ))}
          </div>
          <form className="flex gap-3 p-4" onSubmit={(e) => { e.preventDefault(); sendText(); }}>
            <label htmlFor="operator-text" className="sr-only">Ketik ucapan operator</label>
            <textarea
              id="operator-text" rows={2} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendText(); } }}
              placeholder={live ? "Ketik ucapan operator, Enter untuk kirim" : "Angkat panggilan dulu"}
              disabled={!live}
              className="min-h-14 flex-1 resize-none rounded-[12px] border-[3px] border-[var(--rule)] bg-white px-4 py-2.5 text-[17px] outline-none focus:border-ink disabled:opacity-50"
            />
            <Button size="lg" className={`self-stretch ${inkBtn}`} disabled={!live || !text.trim()}>Kirim</Button>
          </form>
        </div>
        <Button size="lg" variant="outline" className={inkOutline} disabled={!live || muted} onClick={() => {
          if (micOn) { stopMic(); setMicOn(false); setLevel(0); } else void microphone();
        }}>{muted ? "Sistem bicara, mikrofon dijeda" : micOn ? "Mikrofon aktif · ketuk untuk mematikan" : "Aktifkan mikrofon"}</Button>
      </section>

      <aside aria-label="Panel demo" className="space-y-4 max-[1180px]:col-span-full max-[1180px]:grid max-[1180px]:grid-cols-2 max-[1180px]:gap-4 max-[1180px]:space-y-0 max-[860px]:grid-cols-1">
        <section aria-label="Layar pengguna" className={`${panel} p-4`}>
          <h2 className="mb-3 text-[18px] font-extrabold">Layar pengguna tuli</h2>
          {/* Same look as the user's phone (Sill panels): square card, Gabarito question, ink answer buttons. */}
          <div className="mx-auto w-[300px] rounded-[30px] border-[6px] border-ink bg-[#f4f1ee] p-3 text-[#0b0a0a]">
            {card ? (
              <div className={`space-y-2 p-3 ${card.kind === "instruksi" ? "bg-sill-mustard" : "bg-[#e6e1db]"}`}>
                {card.degradation > 0 && <p className="inline-block bg-ink px-2 text-[12px] font-bold tracking-[0.06em] text-sill-mustard">DEGRADASI L{card.degradation}</p>}
                <p className="font-[family-name:var(--font-display)] text-[26px] leading-7 font-black tracking-[-0.03em]">{card.question}</p>
                {card.options.map((o, i) => (
                  <div
                    key={i}
                    title={o.spoken}
                    className={`flex min-h-12 items-center justify-center font-[family-name:var(--font-display)] text-[18px] font-black ${
                      /tidak tahu/i.test(o.label) ? "shadow-[inset_0_0_0_2px_currentColor]" : card.kind === "instruksi" ? "bg-ink text-sill-mustard" : "bg-ink text-[#f4f1ee]"
                    }`}
                  >
                    {o.label}
                  </div>
                ))}
                <p className="pt-1 font-mono text-[12px] leading-4 text-[#57534e]">{card.kind}</p>
              </div>
            ) : (
              <p className="py-10 text-center text-[15px] text-[#57534e]">Kartu muncul di sini saat operator bertanya.</p>
            )}
          </div>
        </section>

        <section aria-label="Simulasi kegagalan" className={`${panel} p-4`}>
          <h2 className="text-[18px] font-extrabold">Simulasi kegagalan</h2>
          <p className="mb-3 text-[14px] text-[var(--ink-muted)]">Panggilan tetap jalan lewat jalur cadangan.</p>
          <fieldset disabled={!connected || !demo || state === "SELESAI"} className="space-y-2 disabled:opacity-50">
            <legend className="sr-only">Paksa kegagalan</legend>
            {([["llm", "L1", "LLM gagal", "Tombol generik"], ["stt", "L2", "STT gagal", "Frasa siap pakai"], ["tts", "L3", "TTS gagal", "Audio cache"]] as const).map(([key, lv, label, effect]) => (
              <label key={key} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-[12px] border-[3px] px-3 ${forces[key] ? "border-sos bg-sos/8" : "border-[var(--rule)]"}`}>
                <input type="checkbox" className="size-5 accent-[var(--sos)]" checked={forces[key]} onChange={(e) => { const next = { ...forces, [key]: e.target.checked }; if (send({ type: "force_degradation", data: next })) setForces(next); }} />
                <span className="rounded-[6px] bg-ink px-1.5 font-mono text-[13px] font-bold text-paint">{lv}</span>
                <span className="flex flex-col leading-5"><span className="text-[16px] font-bold">{label}</span><span className="text-[13px] text-[var(--ink-muted)]">{effect}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="mt-3 flex min-h-12 items-center gap-3 text-[15px]">
            <input type="checkbox" className="size-5 accent-[var(--ink)]" checked={mulaw} disabled={answered || answering} onChange={(e) => setMulaw(e.target.checked)} />
            <span>Simulasi kodek telepon 8 kHz <span className="text-[13px] text-[var(--ink-muted)]">(dikunci setelah Angkat)</span></span>
          </label>
          <div className="mt-2">
            <p className="text-[14px] font-bold">Level mikrofon <span className="font-normal text-[var(--ink-muted)]">· {muted ? "dijeda" : micOn ? "merekam" : "mati"}</span></p>
            <div className="mt-1 h-3 overflow-hidden rounded-full bg-[var(--rule)]" role="meter" aria-label="Level mikrofon" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}>
              <div className="h-full rounded-full bg-ink transition-[width] duration-100" style={{ width: `${Math.min(100, level * 100)}%` }} />
            </div>
          </div>
        </section>

        <section aria-label="SMS simulasi" className={`${panel} p-4`}>
          <h2 className="text-[18px] font-extrabold">SMS ke kontak darurat</h2>
          <div aria-live="polite" className="mt-2 space-y-2">
            {!sms.length && <p className="text-[14px] text-[var(--ink-muted)]">Belum ada. Muncul saat panggilan gagal (L4).</p>}
            {sms.map((m, i) => (
              <article key={i} className="rounded-[12px] bg-[var(--paper)] p-3">
                <p className="font-mono text-[13px] font-bold">{m.to}</p>
                <p className="text-[15px] leading-5">{m.text}</p>
              </article>
            ))}
          </div>
        </section>
      </aside>
    </main>
  </>;
}
