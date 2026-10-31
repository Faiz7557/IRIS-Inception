"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { CallSocket, type SocketStatus } from "@/lib/ws-client";
import { isSilent, loadProfile, useGeo, vibrate } from "@/lib/geo";
import { t } from "@/lib/copy";
import { INCIDENTS } from "@/lib/incidents";
import type { ClientCard, ClientOption, EndedData, FallbackData, StateData, TimelineData } from "@/lib/protocol";
import { CallHeader, type CallPhase } from "@/components/CallHeader";
import { QuestionCard, type AnswerStatus } from "@/components/QuestionCard";
import { ShortInputSheet } from "@/components/ShortInputSheet";
import { HelpTimeline } from "@/components/HelpTimeline";
import { CloseIcon, SosIcon, WaveIcon } from "@/components/icons";

const CSS = `
.call-flash{position:fixed;inset:0;border:8px solid var(--color-primary);pointer-events:none;z-index:60;animation:jflash 300ms ease-out forwards}
@keyframes jflash{from{opacity:1}to{opacity:0}}
.card-in{animation:jslide 200ms ease-out}
@keyframes jslide{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
@keyframes jfade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.card-in{animation-name:jfade}}
`;

interface Session { ticket: string; ws_url: string; opener: string; practice: boolean; incident: string }
interface Contact { name: string; phone: string }

const EMPTY_TL: TimelineData = { answered_at: null, location_confirmed_at: null, dispatched_at: null, contacts_notified_at: null };

function smsHref(phone: string, body: string) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return `sms:${phone}${ios ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

export default function PanggilanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { fix } = useGeo();
  const fixRef = useRef(fix);
  useEffect(() => {
    fixRef.current = fix;
  }, [fix]);

  const [sess, setSess] = useState<Session | null | undefined>(undefined);
  const [conn, setConn] = useState<SocketStatus>("reconnecting");
  const [st, setSt] = useState<StateData>({ state: "MEMANGGIL", attempt: 1, max_attempts: 3 });
  const [opener, setOpener] = useState<{ text: string; speaking: boolean } | null>(null);
  const [opSpeaking, setOpSpeaking] = useState(false);
  const [partial, setPartial] = useState("");
  const [infos, setInfos] = useState<string[]>([]);
  const [card, setCard] = useState<ClientCard | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [ans, setAns] = useState<AnswerStatus>("idle");
  const [ansErr, setAnsErr] = useState<string | null>(null);
  const [tl, setTl] = useState<TimelineData>(EMPTY_TL);
  const [dispatched, setDispatched] = useState(false);
  const [fb, setFb] = useState<FallbackData | null>(null);
  const [deg, setDeg] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [flash, setFlash] = useState(0);
  const [sheet, setSheet] = useState<ClientOption | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [showOfficer, setShowOfficer] = useState(false);
  const [name, setName] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);

  const sock = useRef<CallSocket | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const answered = useRef(0);
  const cardIdRef = useRef<string | null>(null);

  // Session written by the home page right after POST /v1/calls.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`j112.ticket.${id}`);
      setSess(raw ? (JSON.parse(raw) as Session) : null);
    } catch {
      setSess(null);
    }
  }, [id]);

  const end = useCallback(
    (d: EndedData) => {
      try {
        sessionStorage.setItem(`j112.end.${id}`, JSON.stringify({ ...d, answered: answered.current, practice: sess?.practice }));
      } catch {
        /* summary page copes without it */
      }
      router.replace(`/panggilan/${id}/selesai`);
    },
    [id, router, sess],
  );

  useEffect(() => {
    if (!sess) return;
    const s = new CallSocket(sess.ws_url, sess.ticket);
    sock.current = s;
    const off = [
      s.onStatus((c) => setConn(c)),
      s.on("state", (m) => {
        setSt(m.data);
        if (m.data.state !== "FALLBACK") setFb(null);
        if (!["SIAGA", "MEMANGGIL", "FALLBACK", "SELESAI"].includes(m.data.state))
          setStartedAt((v) => {
            if (v === null) vibrate([80, 60, 80]);
            return v ?? Date.now();
          });
      }),
      s.on("opener", (m) =>
        setOpener((o) => ("text" in m.data ? { text: m.data.text, speaking: true } : o && { ...o, speaking: false })),
      ),
      s.on("operator_speaking", (m) => setOpSpeaking(m.data.active)),
      s.on("transcript_partial", (m) => setPartial(m.data.text)),
      s.on("info", (m) => setInfos((a) => [...a.slice(-1), m.data.transcript])),
      s.on("card", (m) => {
        setCard(m.data);
        setChosen(null);
        setAns("idle");
        setAnsErr(null);
        setSheet(null);
        setPartial("");
      }),
      s.on("answer_status", (m) => {
        if (m.data.card_id !== cardIdRef.current) return;
        if (m.data.status === "speaking") setAns("sending");
        else if (m.data.status === "spoken") {
          setAns("sent");
          answered.current += 1;
          vibrate(50);
        } else {
          setChosen(null);
          setAns("idle");
          setAnsErr("Gagal dibacakan. Coba lagi.");
        }
      }),
      s.on("degradation", (m) => setDeg(m.data.level)),
      s.on("dispatch", (m) => {
        setDispatched(true);
        setTl((x) => ({ ...x, dispatched_at: m.data.dispatched_at }));
      }),
      s.on("timeline", (m) => setTl(m.data)),
      s.on("fallback", (m) => {
        setFb(m.data);
        vibrate([400, 200, 400]);
      }),
      s.on("ended", (m) => end(m.data)),
    ];
    return () => {
      off.forEach((f) => f());
      s.close();
      sock.current = null;
    };
  }, [sess, end]);

  // New card: report shown, move focus, one 300 ms frame flash + vibrate (not in silent mode).
  useEffect(() => {
    if (!card) return;
    cardIdRef.current = card.card_id;
    sock.current?.send("card_shown", { card_id: card.card_id });
    cardRef.current?.focus();
    if (!isSilent()) {
      setFlash((n) => n + 1);
      vibrate([200, 100, 200]);
    }
  }, [card?.card_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wake lock for the duration of the call.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const get = () => navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    get();
    const vis = () => document.visibilityState === "visible" && get();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      lock?.release().catch(() => {});
    };
  }, []);

  // Best-effort extras: name for the "show officer" screen, contacts for the SMS fallback.
  useEffect(() => {
    loadProfile().then((p) => p?.display_name && setName(p.display_name));
    api<Contact[] | { contacts: Contact[] }>("/v1/me/contacts")
      .then((r) => setContacts(Array.isArray(r) ? r : r.contacts))
      .catch(() => {});
  }, []);

  const choose = (o: ClientOption) => {
    if (!card || chosen !== null) return;
    setAnsErr(null);
    if (o.action === "ketik") return setSheet(o);
    if (o.action === "ulangi") return repeat();
    if (o.action === "kirim_gps") {
      const f = fixRef.current;
      if (!f) return setAnsErr("Lokasi belum tersedia. Pilih jawaban lain.");
      setChosen(o.index);
      setAns("sending");
      return sock.current?.send("gps", { card_id: card.card_id, option_index: o.index, lat: f.lat, lng: f.lng, accuracy_m: f.accuracy_m });
    }
    setChosen(o.index);
    setAns("sending");
    sock.current?.send("tap", { card_id: card.card_id, option_index: o.index });
  };
  const sendText = (text: string) => {
    if (!card || !sheet) return;
    setChosen(sheet.index);
    setAns("sending");
    setSheet(null);
    sock.current?.send("text", { card_id: card.card_id, option_index: sheet.index, text });
  };
  const repeat = () => card && sock.current?.send("repeat", { card_id: card.card_id });
  const cancel = () => {
    sock.current?.send("cancel", { confirm: true });
    setConfirm(false);
    setTimeout(() => router.replace(`/panggilan/${id}/selesai`), 4000); // safety net if `ended` never arrives
  };

  if (sess === undefined) return null;
  if (sess === null)
    return (
      <main className="mx-auto max-w-[480px] space-y-4 p-4">
        <h1 className="text-[24px] font-bold">Sesi panggilan tidak ditemukan</h1>
        <Link href="/" className="flex min-h-[56px] items-center justify-center rounded-[12px] bg-[color:var(--color-primary)] font-bold text-white">
          Kembali ke beranda
        </Link>
      </main>
    );

  const incidentLabel = INCIDENTS.find((i) => i.id === sess.incident)?.label ?? "Umum";
  const phase: CallPhase = fb ? "failed" : startedAt ? "connected" : "dialing";
  const total = card ? card.total : 0;
  const idx = card ? Math.min(Math.max(1, card.index), total || 1) : 0;
  const waiting = st.state === "MENYEDERHANAKAN";

  let view: React.ReactNode;
  if (fb) {
    const body = fb.sms_text;
    view = (
      <section aria-labelledby="fb-title" className="space-y-4">
        <div className="flex items-center gap-3 text-[color:var(--color-sos)]">
          <SosIcon size={40} />
          <h2 id="fb-title" className="text-[32px] font-bold leading-10 text-[color:var(--color-text)]">{t("fallback.title")}</h2>
        </div>
        {fb.contacts_notified > 0 && <p>{t("fallback.contacts_notified")}</p>}
        {fb.can_retry ? (
          <button
            type="button"
            onClick={() => sock.current?.send("retry", {})}
            className="min-h-[64px] w-full rounded-[12px] bg-[color:var(--color-primary)] text-[18px] font-bold text-white"
          >
            {t("fallback.retry")}
          </button>
        ) : (
          <>
            <p className="font-bold">Hubungi orang di sekitar Anda.</p>
            <button
              type="button"
              onClick={() => setShowOfficer(true)}
              className="min-h-[64px] w-full rounded-[12px] bg-[color:var(--color-primary)] text-[18px] font-bold text-white"
            >
              Tunjukkan layar ke orang lain
            </button>
          </>
        )}
        <div className="space-y-2">
          {(contacts.length ? contacts : [{ name: "", phone: "" }]).map((c, i) => (
            <a
              key={i}
              href={smsHref(c.phone, body)}
              className="flex min-h-[56px] items-center justify-center rounded-[12px] border-2 border-[color:var(--color-primary)] font-bold text-[color:var(--color-accent)]"
            >
              {t("fallback.sms")}{c.name ? `: ${c.name}` : ""}
            </a>
          ))}
        </div>
      </section>
    );
  } else if (dispatched) {
    view = (
      <>
        {card && (
          <QuestionCard
            ref={cardRef} card={card} chosen={chosen} status={ans} gpsAccuracy={fix?.accuracy_m ?? null}
            pendingAfter={Math.max(0, total - idx)} silentDot={isSilent()} onOption={choose} onRepeat={repeat}
          />
        )}
        <HelpTimeline timeline={{ ...tl, answered_at: tl.answered_at ?? (startedAt ? new Date(startedAt).toISOString() : null) }} onShow={() => setShowOfficer(true)} />
      </>
    );
  } else if (card) {
    view = (
      <>
        {ans === "sent" && waiting && <p className="text-[color:var(--color-text-muted)]">Menyiapkan pertanyaan…</p>}
        <QuestionCard
          ref={cardRef} card={card} chosen={chosen} status={ans} gpsAccuracy={fix?.accuracy_m ?? null}
          pendingAfter={Math.max(0, total - idx)} silentDot={isSilent()} onOption={choose} onRepeat={repeat}
        />
        {ansErr && <p role="alert" className="font-bold text-[color:var(--color-sos)]">{ansErr}</p>}
        {infos.map((x, i) => (
          <p key={i} className="rounded-[12px] bg-[color:var(--color-surface)] p-3 text-[16px] leading-6">{x}</p>
        ))}
      </>
    );
  } else if (!startedAt) {
    view = (
      <section className="space-y-4" aria-labelledby="dial-title">
        <h1 id="dial-title" className="text-[32px] font-bold leading-10">{t("call.dialing")}</h1>
        <p className="text-[18px]">{t("call.attempt", { n: st.attempt })}</p>
        <div className="rounded-[12px] bg-[color:var(--color-surface)] p-3">
          <p className="text-[16px] text-[color:var(--color-text-muted)]">Yang akan dibacakan ke operator:</p>
          <p>{sess.opener || `Panggilan relay otomatis untuk ${incidentLabel}.`}</p>
        </div>
      </section>
    );
  } else if (st.state === "PEMBUKA" || (opener && opener.speaking)) {
    view = (
      <section className="space-y-3" aria-labelledby="op-title">
        <h2 id="op-title" className="text-[24px] font-bold">{t("call.opener.title")}</h2>
        <p className={`rounded-[12px] p-3 leading-7 ${opener?.speaking ? "bg-[color:var(--color-warning-bg)] ring-2 ring-[color:var(--color-primary)]" : "bg-[color:var(--color-surface)]"}`}>
          {opener?.text ?? sess.opener}
        </p>
      </section>
    );
  } else {
    view = (
      <section className="space-y-4 text-center" aria-live="polite">
        <div className="flex justify-center text-[color:var(--color-accent)]"><WaveIcon size={64} /></div>
        <p className="text-[24px] font-bold">{opSpeaking ? t("call.operator_speaking") : "Mendengarkan operator…"}</p>
        {partial && <p className="rounded-[12px] bg-[color:var(--color-surface)] p-3 text-left text-[16px] leading-6">{partial}</p>}
        {waiting && <p className="text-[color:var(--color-text-muted)]">Menyiapkan pertanyaan…</p>}
        {infos.map((x, i) => (
          <p key={i} className="rounded-[12px] bg-[color:var(--color-surface)] p-3 text-left text-[16px] leading-6">{x}</p>
        ))}
      </section>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px]">
      <style>{CSS}</style>
      {flash > 0 && <div key={flash} className="call-flash" aria-hidden />}
      <CallHeader
        phase={phase} attempt={st.attempt} maxAttempts={st.max_attempts} startedAt={startedAt}
        practice={sess.practice} speaking={opSpeaking} onCancel={() => setConfirm(true)}
      />
      {conn === "reconnecting" && <p role="status" className="bg-[color:var(--color-warning-bg)] px-4 py-1 text-[16px] text-[color:var(--color-warning)]">Menyambung ulang…</p>}
      {conn === "closed" && <p role="alert" className="bg-[color:var(--color-warning-bg)] px-4 py-1 text-[16px] text-[color:var(--color-warning)]">Sambungan terputus.</p>}
      {(deg === 2 || deg === 3) && (
        <p className="px-4 pt-2 text-[16px] text-[color:var(--color-warning)]">{deg === 2 ? "Teks operator tidak tersedia" : "Suara terbatas"}</p>
      )}
      <main className="space-y-4 px-4 pb-8 pt-4">{view}</main>

      {sheet && (
        <ShortInputSheet
          suggestions={(card?.options ?? []).filter((o) => o.action === "ucap" && !/tidak tahu/i.test(o.label)).map((o) => o.label)}
          onSend={sendText}
          onClose={() => setSheet(null)}
        />
      )}

      {confirm && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="cc-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-[400px] space-y-4 rounded-[16px] bg-[color:var(--color-surface)] p-4">
            <h2 id="cc-title" className="text-[24px] font-bold">{t("call.cancel.confirm")}</h2>
            <div className="flex gap-3">
              <button type="button" autoFocus onClick={() => setConfirm(false)} className="min-h-[56px] flex-1 rounded-[12px] border-2 border-[color:var(--color-primary)] font-bold text-[color:var(--color-accent)]">Tidak</button>
              <button type="button" onClick={cancel} className="min-h-[56px] flex-1 rounded-[12px] bg-[color:var(--color-sos)] font-bold text-white">Ya</button>
            </div>
          </div>
        </div>
      )}

      {showOfficer && (
        <div role="dialog" aria-modal="true" aria-label="Ringkasan untuk petugas" className="fixed inset-0 z-50 flex flex-col justify-center gap-4 bg-[color:var(--color-surface)] p-6">
          <button type="button" onClick={() => setShowOfficer(false)} aria-label="Tutup" className="absolute right-3 top-3 flex min-h-[56px] min-w-[56px] items-center justify-center"><CloseIcon size={32} /></button>
          <p className="text-[40px] font-bold leading-tight">{name || "Pengguna"}</p>
          <p className="text-[32px] leading-10">{incidentLabel}</p>
          <p className="text-[32px] leading-10">Saya tuli. Tolong bantu saya.</p>
        </div>
      )}
    </div>
  );
}
