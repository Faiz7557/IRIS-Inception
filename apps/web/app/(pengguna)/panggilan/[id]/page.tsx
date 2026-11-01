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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckIcon, GpsIcon, IdCardIcon, SosIcon, WaveIcon } from "@/components/icons";
import { ShowCard } from "@/components/ShowCard";

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
    <details className="m-surface px-[18px] py-3 text-left">
      <summary className="min-h-[44px] cursor-pointer content-center text-[16px] font-semibold underline underline-offset-4">
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
  const [address, setAddress] = useState("");
  const hasAddress = address !== "";
  const [answeredN, setAnsweredN] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const sock = useRef<CallSocket | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const answered = useRef(0);
  // Question + answer pairs for the summary page; an answer is logged only once the operator heard it.
  const log = useRef<{ q: string; a: string }[]>([]);
  const pendingAns = useRef<{ q: string; a: string } | null>(null);
  const dispatchedRef = useRef(false);
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
        sessionStorage.setItem(`j112.end.${id}`, JSON.stringify({
          ...d, answered: answered.current, practice: sess?.practice, incident: sess?.incident,
          dispatched: dispatchedRef.current, log: log.current,
        }));
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
          if (pendingAns.current) log.current.push(pendingAns.current);
          pendingAns.current = null;
          vibrate(50);
        } else {
          pendingAns.current = null;
          setChosen(null);
          setAns("idle");
          setAnsErr("Gagal dibacakan. Coba lagi.");
        }
      }),
      s.on("degradation", (m) => setDeg(m.data.level)),
      s.on("dispatch", (m) => {
        setDispatched(true);
        dispatchedRef.current = true;
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
      setAddress(typeof p?.address === "string" ? p.address.trim() : "");
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
      pendingAns.current = { q: card.question, a: `Lokasi GPS (akurat ${f.accuracy_m} m)` };
      return sock.current?.send("gps", { card_id: card.card_id, option_index: o.index, lat: f.lat, lng: f.lng, accuracy_m: f.accuracy_m });
    }
    setChosen(o.index);
    setAns("sending");
    pendingAns.current = { q: card.question, a: o.label };
    sock.current?.send("tap", { card_id: card.card_id, option_index: o.index });
  };
  const sendText = (text: string) => {
    if (!card || !sheet) return;
    setChosen(sheet.index);
    setAns("sending");
    pendingAns.current = { q: card.question, a: text };
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
      <main className="s-page">
        <h1 className="s-panel tone-ink s-title">Sesi panggilan tidak ditemukan</h1>
        <Link href="/" className="m-btn w-full">
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
      <section aria-labelledby="fb-title" className="space-y-2">
        <div className="s-panel flex items-center gap-4 bg-sos text-white">
          <SosIcon size={40} />
          <h2 id="fb-title" className="s-h2">{t("fallback.title")}</h2>
        </div>
        {fb.contacts_notified > 0 && (
          <p className="s-panel m-surface flex items-center gap-3 text-[18px] leading-7 font-semibold">
            <CheckIcon size={24} />
            {t("fallback.contacts_notified")}
          </p>
        )}
        {fb.can_retry ? (
          <button type="button" className="m-btn w-full" onClick={() => sock.current?.send("retry", {})}>{t("fallback.retry")}</button>
        ) : (
          <>
            <p className="s-panel m-surface text-[18px] font-semibold">Hubungi orang di sekitar Anda.</p>
            <button type="button" className="m-btn w-full" onClick={() => setShowOfficer(true)}>Tunjukkan layar ke orang lain</button>
          </>
        )}
        {(contacts.length ? contacts : [{ name: "", phone: "" }]).map((c, i) => (
          <a key={i} href={smsHref(c.phone, fb.sms_text)} className="m-btn m-btn--line w-full">
            {t("fallback.sms")}{c.name ? `: ${c.name}` : ""}
          </a>
        ))}
      </section>
    );
  } else if (dispatched) {
    view = (
      <section className="space-y-2" aria-labelledby="help-title">
        <div className="s-panel tone-sage flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-ink text-sill-sage"><CheckIcon size={34} /></span>
          <h2 id="help-title" className="s-title !text-[40px]">{t("help.title")}</h2>
        </div>
        <div className="s-panel m-surface"><RouteBoard stops={stops} paint={paint} /></div>
        <p className="s-panel m-surface text-[18px] leading-7 font-semibold">{t("help.stay_safe")}</p>
        <button type="button" className="m-btn w-full" onClick={() => setShowOfficer(true)}>Tunjukkan ke petugas</button>
      </section>
    );
  } else if (card) {
    view = (
      <>
        <RouteBoard stops={stops} paint={paint} compact />
        {ans === "sent" && waiting && <p className="px-2 text-text-muted">Menyiapkan pertanyaan…</p>}
        <QuestionCard
          ref={cardRef} card={card} chosen={chosen} status={ans} gpsAccuracy={fix?.accuracy_m ?? null}
          pendingAfter={Math.max(0, total - idx)} silentDot={isSilent()} onOption={choose} onRepeat={repeat}
        />
        {ansErr && <p role="alert" className="s-panel tone-mustard font-semibold">{ansErr}</p>}
        {infos.map((x, i) => (
          <p key={i} className="m-surface px-[18px] py-3 text-[16px] leading-6">{x}</p>
        ))}
      </>
    );
  } else {
    // Waiting stages (dialing, opener, listening) share one layout: the route is the screen.
    const speaking = startedAt !== null && (st.state === "PEMBUKA" || !!opener?.speaking);
    const gpsGood = !!fix && fix.accuracy_m <= 100;
    view = (
      <section className="space-y-2" aria-live="polite">
        <h1 className="sr-only">{!startedAt ? t("call.dialing") : speaking ? t("call.opener.title") : "Mendengarkan operator"}</h1>
        <div className="s-panel m-surface"><RouteBoard stops={stops} paint={paint} /></div>
        <p className="s-panel tone-ink flex items-center gap-3 !py-4 text-[18px] leading-6 font-semibold">
          {startedAt && opSpeaking ? <WaveIcon size={24} /> : <span aria-hidden className="size-3 shrink-0 animate-pulse rounded-full bg-sill-mustard" />}
          {startedAt && opSpeaking ? t("call.operator_speaking") : waiting ? "Menyiapkan pertanyaan…" : t("call.wait")}
        </p>
        {partial && <p className="m-surface px-[18px] py-3 text-[16px] leading-6 text-text-muted">{partial}</p>}
        {infos.map((x, i) => (
          <p key={i} className="m-surface px-[18px] py-3 text-[16px] leading-6">{x}</p>
        ))}
        {/* What the opener carries, as facts the user can check at a glance (product principle 3). */}
        <section aria-labelledby="knows-title" className="s-panel m-surface !py-4">
          <h2 id="knows-title" className="m-label">{openerDone ? "Sudah dibacakan ke operator" : "Akan dibacakan ke operator"}</h2>
          <ul className="space-y-2 text-[18px] leading-6 font-semibold">
            {[
              { ok: true, text: `Kejadian: ${incidentLabel}` },
              // Mirrors opener.py: GPS is read out only at ≤ 100 m, otherwise the profile address.
              {
                ok: gpsGood || hasAddress,
                text: gpsGood ? `Lokasi GPS, akurat ${fix!.accuracy_m} m` : hasAddress ? `Alamat: ${address}` : "Lokasi belum ada. Operator akan bertanya.",
              },
              ...(name ? [{ ok: true, text: `Nama: ${name}` }] : []),
              { ok: true, text: "Anda tuli dan menjawab lewat tombol" },
            ].map((x) => (
              <li key={x.text} className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 ${x.ok ? (openerDone ? "text-[color:var(--color-success)]" : "text-text-muted") : "text-[color:var(--color-sos)]"}`}>
                  {x.ok ? <CheckIcon size={22} /> : <GpsIcon size={22} />}
                </span>
                <span className="min-w-0">{x.text}</span>
              </li>
            ))}
          </ul>
        </section>
        <OpenerText text={opener?.text ?? (sess.opener || `Panggilan relay otomatis untuk ${incidentLabel}.`)} />
      </section>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px]">
      <style>{CSS}</style>
      {flash > 0 && <div key={flash} className="call-flash" aria-hidden />}
      <CallHeader phase={phase} incident={sess.incident} startedAt={startedAt} practice={sess.practice} />
      <div className="space-y-2 px-2 pt-2 empty:hidden">
        {conn === "reconnecting" && <p role="status" className="tone-mustard px-[18px] py-2 text-[16px] font-semibold">Menyambung ulang…</p>}
        {authFailed && (
          <div role="alert" className="tone-mustard space-y-3 px-[18px] py-4">
            <p className="text-[18px] font-semibold">Sesi panggilan tidak bisa diverifikasi. Silakan mulai ulang dari beranda.</p>
            <Link href="/" className="m-btn w-full">Kembali ke beranda</Link>
          </div>
        )}
        {conn === "closed" && !authFailed && <p role="alert" className="tone-mustard px-[18px] py-2 text-[16px] font-semibold">Sambungan terputus.</p>}
        {(deg === 2 || deg === 3) && (
          <p className="tone-mustard px-[18px] py-2 text-[16px] font-semibold">{deg === 2 ? "Teks operator tidak tersedia" : "Suara terbatas"}</p>
        )}
      </div>
      <main className="s-instant space-y-2 px-2 pt-2 pb-8">
        {view}
        {/* Someone may walk up mid-call: the officer card is one tap away on every stage, not only after dispatch. */}
        {!fb && !dispatched && (
          <button type="button" onClick={() => setShowOfficer(true)} className="m-icon-btn w-full !min-h-14">
            <IdCardIcon size={22} />
            Tunjukkan ke orang di sekitar
          </button>
        )}
        <button type="button" onClick={() => setConfirm(true)} className="m-btn m-btn--danger mt-6 w-full">
          {t("call.cancel")} panggilan
        </button>
      </main>

      {sheet && (
        <ShortInputSheet
          suggestions={(card?.options ?? []).filter((o) => o.action === "ucap" && !/tidak tahu/i.test(o.label)).map((o) => o.label)}
          onSend={sendText}
          onClose={() => setSheet(null)}
        />
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent role="alertdialog" showCloseButton={false} className="max-w-[400px] rounded-none border-0 bg-surface p-[18px] text-text">
          <DialogTitle className="s-h2">{t("call.cancel.confirm")}</DialogTitle>
          <DialogDescription className="text-[17px] leading-6 text-text-muted">Operator 112 tidak bisa lagi bertanya kepada Anda.</DialogDescription>
          <div className="mt-2 flex gap-2">
            <button type="button" autoFocus className="m-btn m-btn--line flex-1" onClick={() => setConfirm(false)}>Tidak</button>
            <button type="button" className="m-btn m-btn--sos flex-1" onClick={cancel}>Ya, batalkan</button>
          </div>
        </DialogContent>
      </Dialog>

      {showOfficer && (
        <ShowCard
          title="Saya tuli. Tolong bantu saya."
          lines={[incidentLabel, ...(name ? [`Nama: ${name}`] : [])]}
          incident={sess.incident}
          paint={paint}
          onClose={() => setShowOfficer(false)}
        />
      )}
    </div>
  );
}
