"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { CallSocket, type SocketStatus } from "@/lib/ws-client";
import { isSilent, loadProfile, useGeo, vibrate } from "@/lib/geo";
import { t } from "@/lib/copy";
import { paintOf } from "@/lib/incidents";
import type { ClientCard, ClientOption, EndedData, FallbackData, StateData, TimelineData } from "@/lib/protocol";
import { CallHeader, type CallPhase } from "@/components/CallHeader";
import { QuestionCard, type AnswerStatus } from "@/components/QuestionCard";
import { ShortInputSheet } from "@/components/ShortInputSheet";
import { RouteBoard, type Stop } from "@/components/RouteBoard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckIcon, CloseIcon, IncidentIcon, SosIcon, WaveIcon } from "@/components/icons";

const CSS = `
.call-flash{position:fixed;inset:0;border:8px solid var(--color-primary);pointer-events:none;z-index:60;animation:jflash 300ms ease-out forwards}
@keyframes jflash{from{opacity:1}to{opacity:0}}
.card-in{animation:jslide 200ms ease-out}
@keyframes jslide{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
@keyframes jfade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.card-in{animation-name:jfade}}
`;

/** The opener is ~35 words of spoken Indonesian: available, but folded so a panicked user sees one short line. */
function OpenerText({ text }: { text: string }) {
  return (
    <details className="rounded-[12px] bg-[color:var(--color-surface)] p-3 text-left">
      <summary className="min-h-[44px] cursor-pointer content-center text-[16px] font-bold text-[color:var(--color-accent)]">
        Lihat pesan untuk operator
      </summary>
      <p className="mt-2 leading-7">{text}</p>
    </details>
  );
}

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
  const [authFailed, setAuthFailed] = useState(false);
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
  const [hasAddress, setHasAddress] = useState(false);
  const [answeredN, setAnsweredN] = useState(0);
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
    const s = new CallSocket(sess.ws_url, sess.ticket, () =>
      api<{ ws_ticket: string }>(`/v1/calls/${id}/ticket`, { method: "POST" })
        .then((r) => r.ws_ticket)
        .catch(() => null),
    );
    sock.current = s;
    const off = [
      s.onStatus((c, code) => {
        setConn(c);
        setAuthFailed(c === "closed" && code === 4401);
      }),
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
          setAnsweredN(answered.current);
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
  }, [sess, end, id]);

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
    loadProfile().then((p) => {
      if (p?.display_name) setName(p.display_name);
      setHasAddress(typeof p?.address === "string" && p.address.trim() !== "");
    });
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
        <Link href="/" className="flex min-h-[56px] items-center justify-center rounded-[12px] bg-[color:var(--color-primary)] font-extrabold text-ink">
          Kembali ke beranda
        </Link>
      </main>
    );

  const paint = paintOf(sess.incident);
  const incidentLabel = paint.label;
  const phase: CallPhase = fb ? "failed" : startedAt ? "connected" : "dialing";
  const total = card ? card.total : 0;
  const idx = card ? card.index + 1 : 0; // server index is 0-based
  const waiting = st.state === "MENYEDERHANAKAN";

  // The route board: every stop is derived from state the server already sends, nothing new on the wire.
  const openerDone = startedAt !== null && st.state !== "PEMBUKA" && !opener?.speaking;
  const knows = [incidentLabel.toLowerCase(), ...(fix || hasAddress || tl.location_confirmed_at ? ["alamat Anda"] : [])].join(" dan ");
  const stops: Stop[] = [
    {
      label: startedAt ? "Tersambung ke 112" : "Menelepon 112",
      sub: !startedAt && st.attempt > 1 ? t("call.attempt", { n: st.attempt }) : undefined,
      state: startedAt ? "done" : "current",
    },
    {
      label: openerDone ? `Operator tahu ${knows}` : t("call.opener.title"),
      state: !startedAt ? "todo" : openerDone ? "done" : "current",
    },
    {
      label: "Operator bertanya",
      sub: openerDone && !dispatched && answeredN > 0 ? `${answeredN} pertanyaan dijawab` : undefined,
      state: !openerDone ? "todo" : dispatched ? "done" : "current",
    },
    { label: "Petugas berangkat", state: dispatched ? "done" : "todo" },
  ];

  let view: React.ReactNode;
  if (fb) {
    view = (
      <section aria-labelledby="fb-title" className="space-y-4">
        <div className="flex items-center gap-4 rounded-[14px] bg-sos p-4 text-white">
          <SosIcon size={40} />
          <h2 id="fb-title" className="text-[26px] leading-8 font-extrabold tracking-[-0.01em]">{t("fallback.title")}</h2>
        </div>
        {fb.contacts_notified > 0 && (
          <p className="flex items-center gap-3 rounded-[12px] bg-asphalt-2 p-4 text-[18px] leading-7 font-bold">
            <span className="text-done"><CheckIcon size={24} /></span>
            {t("fallback.contacts_notified")}
          </p>
        )}
        {fb.can_retry ? (
          <Button size="xl" className="w-full" onClick={() => sock.current?.send("retry", {})}>{t("fallback.retry")}</Button>
        ) : (
          <>
            <p className="text-[18px] font-bold">Hubungi orang di sekitar Anda.</p>
            <Button size="xl" className="w-full" onClick={() => setShowOfficer(true)}>Tunjukkan layar ke orang lain</Button>
          </>
        )}
        <div className="space-y-2">
          {(contacts.length ? contacts : [{ name: "", phone: "" }]).map((c, i) => (
            <Button key={i} asChild variant="outline" size="lg" className="w-full">
              <a href={smsHref(c.phone, fb.sms_text)}>{t("fallback.sms")}{c.name ? `: ${c.name}` : ""}</a>
            </Button>
          ))}
        </div>
      </section>
    );
  } else if (dispatched) {
    view = (
      <section className="space-y-5" aria-labelledby="help-title">
        <div className="flex items-center gap-4 rounded-[14px] p-4" style={{ background: "var(--done)", color: "var(--ink-dark)" }}>
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-ink text-done"><CheckIcon size={34} /></span>
          <h2 id="help-title" className="text-[28px] leading-8 font-extrabold tracking-[-0.01em]">{t("help.title")}</h2>
        </div>
        <RouteBoard stops={stops} paint={paint} />
        <p className="rounded-[12px] bg-asphalt-2 p-4 text-[18px] leading-7 font-bold">{t("help.stay_safe")}</p>
        <Button size="xl" className="w-full" onClick={() => setShowOfficer(true)}>Tunjukkan ke petugas</Button>
      </section>
    );
  } else if (card) {
    view = (
      <>
        <RouteBoard stops={stops} paint={paint} compact />
        {ans === "sent" && waiting && <p className="text-paint-muted">Menyiapkan pertanyaan…</p>}
        <QuestionCard
          ref={cardRef} card={card} chosen={chosen} status={ans} gpsAccuracy={fix?.accuracy_m ?? null}
          pendingAfter={Math.max(0, total - idx)} silentDot={isSilent()} onOption={choose} onRepeat={repeat}
        />
        {ansErr && <p role="alert" className="font-bold text-signal">{ansErr}</p>}
        {infos.map((x, i) => (
          <p key={i} className="rounded-[12px] bg-asphalt-2 p-3 text-[16px] leading-6">{x}</p>
        ))}
      </>
    );
  } else {
    // Waiting stages (dialing, opener, listening) share one layout: the route is the screen.
    const speaking = startedAt !== null && (st.state === "PEMBUKA" || !!opener?.speaking);
    view = (
      <section className="space-y-5" aria-live="polite">
        <h1 className="sr-only">{!startedAt ? t("call.dialing") : speaking ? t("call.opener.title") : "Mendengarkan operator"}</h1>
        <RouteBoard stops={stops} paint={paint} />
        <p className="flex min-h-14 items-center gap-3 rounded-[12px] bg-asphalt-2 px-4 text-[18px] leading-6 font-bold">
          {startedAt && opSpeaking ? <WaveIcon size={24} /> : <span aria-hidden className="size-3 shrink-0 animate-pulse rounded-full bg-signal" />}
          {startedAt && opSpeaking ? t("call.operator_speaking") : waiting ? "Menyiapkan pertanyaan…" : t("call.wait")}
        </p>
        {partial && <p className="rounded-[12px] bg-asphalt-2 p-3 text-[16px] leading-6 text-paint-muted">{partial}</p>}
        {infos.map((x, i) => (
          <p key={i} className="rounded-[12px] bg-asphalt-2 p-3 text-[16px] leading-6">{x}</p>
        ))}
        <OpenerText text={opener?.text ?? (sess.opener || `Panggilan relay otomatis untuk ${incidentLabel}.`)} />
      </section>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px]">
      <style>{CSS}</style>
      {flash > 0 && <div key={flash} className="call-flash" aria-hidden />}
      <CallHeader phase={phase} incident={sess.incident} startedAt={startedAt} practice={sess.practice} onCancel={() => setConfirm(true)} />
      {conn === "reconnecting" && <p role="status" className="bg-warning-bg px-4 py-1.5 text-[16px] font-bold text-signal">Menyambung ulang…</p>}
      {authFailed && (
        <div role="alert" className="space-y-3 bg-warning-bg px-4 py-3">
          <p className="text-[18px] font-bold text-signal">Sesi panggilan tidak bisa diverifikasi. Silakan mulai ulang dari beranda.</p>
          <Button asChild size="lg" className="w-full"><Link href="/">Kembali ke beranda</Link></Button>
        </div>
      )}
      {conn === "closed" && !authFailed && <p role="alert" className="bg-warning-bg px-4 py-1.5 text-[16px] font-bold text-signal">Sambungan terputus.</p>}
      {(deg === 2 || deg === 3) && (
        <p className="px-4 pt-2 text-[16px] font-bold text-signal">{deg === 2 ? "Teks operator tidak tersedia" : "Suara terbatas"}</p>
      )}
      <main className="space-y-4 px-4 pt-4 pb-8">{view}</main>

      {sheet && (
        <ShortInputSheet
          suggestions={(card?.options ?? []).filter((o) => o.action === "ucap" && !/tidak tahu/i.test(o.label)).map((o) => o.label)}
          onSend={sendText}
          onClose={() => setSheet(null)}
        />
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent role="alertdialog" showCloseButton={false} className="max-w-[400px] rounded-[16px] bg-asphalt-2 p-5">
          <DialogTitle className="text-[26px] leading-8 font-extrabold">{t("call.cancel.confirm")}</DialogTitle>
          <DialogDescription className="text-[17px] leading-6 text-paint-muted">Operator 112 tidak bisa lagi bertanya kepada Anda.</DialogDescription>
          <div className="mt-2 flex gap-3">
            <Button autoFocus size="lg" variant="outline" className="flex-1" onClick={() => setConfirm(false)}>Tidak</Button>
            <Button size="lg" variant="sos" className="flex-1" onClick={cancel}>Ya, batalkan</Button>
          </div>
        </DialogContent>
      </Dialog>

      {showOfficer && (
        <div
          role="dialog" aria-modal="true" aria-label="Ringkasan untuk petugas"
          style={{ background: paint.bg, color: paint.fg }}
          className="fixed inset-0 z-50 flex flex-col justify-center gap-5 p-7"
        >
          <button type="button" onClick={() => setShowOfficer(false)} aria-label="Tutup" className="absolute top-3 right-3 flex size-14 items-center justify-center"><CloseIcon size={34} /></button>
          <IncidentIcon id={sess.incident} size={72} />
          <p className="text-[44px] leading-[48px] font-extrabold tracking-[-0.02em]">Saya tuli. Tolong bantu saya.</p>
          <p className="text-[30px] leading-9 font-bold">{incidentLabel}</p>
          {name && <p className="text-[24px] leading-8">Nama: {name}</p>}
        </div>
      )}
    </div>
  );
}
