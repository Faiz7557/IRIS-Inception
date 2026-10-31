"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { INCIDENTS } from "@/lib/incidents";
import { t } from "@/lib/copy";
import { loadProfile, useGeo, vibrate } from "@/lib/geo";
import { saveLocalProfile } from "@/lib/offline-store";
import type { CreateCall, Incident } from "@/lib/protocol";
import { IncidentTile } from "@/components/IncidentTile";
import { SosHoldButton } from "@/components/SosHoldButton";
import { GpsIcon } from "@/components/icons";

interface CallCreated {
  call_id: string;
  ws_url: string;
  ws_ticket: string;
  opener_text?: string;
  practice?: boolean;
}

function deviceKey(): string {
  try {
    let k = localStorage.getItem("j112.device_key");
    if (!k) {
      k = crypto.randomUUID();
      localStorage.setItem("j112.device_key", k);
    }
    return k;
  } catch {
    return crypto.randomUUID();
  }
}

export default function BerandaPage() {
  const router = useRouter();
  const { fix, error } = useGeo();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [practice, setPractice] = useState(true); // default latihan until profile says otherwise
  const [address, setAddress] = useState<string | null>(null); // null = not loaded yet, "" = none
  const hasAddress = address === null ? null : address !== "";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doubleTap, setDoubleTap] = useState(false);
  const [silentNotice, setSilentNotice] = useState<string | null>(null);
  const headerTimer = useRef<number | NodeJS.Timeout | null>(null);
  const noticeTimer = useRef<number | NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadProfile().then((p) => {
      if (!p) return;
      setPractice(p.practice_mode !== false);
      setAddress(typeof p.address === "string" ? p.address.trim() : "");
      setDoubleTap(!!p.double_tap_sos);
    });
    return () => {
      clearTimeout(headerTimer.current ?? undefined);
      clearTimeout(noticeTimer.current ?? undefined);
    };
  }, []);

  const toggleSilent = useCallback(async () => {
    const nextSilent = !document.documentElement.classList.contains("silent");
    document.documentElement.classList.toggle("silent", nextSilent);
    vibrate(50);
    const msg = nextSilent ? "Mode senyap aktif" : "Mode senyap nonaktif";
    setSilentNotice(msg);
    clearTimeout(noticeTimer.current ?? undefined);
    noticeTimer.current = setTimeout(() => setSilentNotice(null), 2500);
    try {
      const p = await loadProfile();
      if (p) {
        const updated = { ...p, silent_mode: nextSilent };
        await api("/v1/me/profile", { method: "PUT", body: JSON.stringify(updated) });
        await saveLocalProfile(updated as Parameters<typeof saveLocalProfile>[0]);
      }
    } catch {
      /* local toggle stays */
    }
  }, []);

  const onHeaderPointerDown = useCallback(() => {
    clearTimeout(headerTimer.current ?? undefined);
    headerTimer.current = setTimeout(() => {
      headerTimer.current = null;
      toggleSilent();
    }, 2000);
  }, [toggleSilent]);

  const onHeaderPointerUp = useCallback(() => {
    clearTimeout(headerTimer.current ?? undefined);
    headerTimer.current = null;
  }, []);


  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const offline = `/offline?kejadian=${incident ?? "umum"}`;
    if (!navigator.onLine) return void router.push(offline);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const body: CreateCall = {
      incident: incident ?? "umum",
      mode: practice ? "latihan" : "simulasi",
      device_key: deviceKey(),
      location: fix,
      client_ts: new Date().toISOString(),
    };
    try {
      const r = await api<CallCreated>("/v1/calls", { method: "POST", body: JSON.stringify(body), signal: ctl.signal });
      try {
        sessionStorage.setItem(
          `j112.ticket.${r.call_id}`,
          JSON.stringify({
            ticket: r.ws_ticket, ws_url: r.ws_url, opener: r.opener_text ?? "",
            practice: r.practice ?? practice, incident: body.incident,
          }),
        );
      } catch {
        /* the call page shows a recoverable error */
      }
      router.push(`/panggilan/${r.call_id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        // E1: a call is still active -> fetch a fresh ticket for it and open it.
        const id = e.status === 409 && typeof e.details.call_id === "string" ? e.details.call_id : null;
        if (id) {
          try {
            const tk = await api<{ ws_ticket: string; ws_url: string }>(`/v1/calls/${id}/ticket`, { method: "POST" });
            sessionStorage.setItem(
              `j112.ticket.${id}`,
              JSON.stringify({ ticket: tk.ws_ticket, ws_url: tk.ws_url, opener: "", practice, incident: body.incident }),
            );
          } catch {
            /* the call page shows a recoverable error */
          }
          return void router.push(`/panggilan/${id}`);
        }
        setErr(e.status === 409 ? "Panggilan sebelumnya masih berjalan." : e.status === 429 ? "Terlalu sering. Coba lagi nanti." : e.message);
        setBusy(false);
      } else {
        router.push(offline); // network failure or 5 s timeout
      }
    } finally {
      clearTimeout(timer);
    }
  }, [busy, fix, incident, practice, router]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-4 pb-6">
      <div className="flex min-h-12 items-center justify-between">
        {practice ? (
          <Link
            href="/pengaturan"
            className="rounded-[6px] bg-signal px-2.5 py-0.5 text-[14px] leading-6 font-extrabold tracking-[0.06em] text-ink"
            aria-label={`${t("practice.banner")}. Ubah di pengaturan.`}
          >
            LATIHAN
          </Link>
        ) : (
          <span />
        )}
        <Link href="/pengaturan" aria-label="Pengaturan" className="flex min-h-12 min-w-12 items-center justify-end font-bold text-paint/85">
          Atur
        </Link>
      </div>

      <h1
        onPointerDown={onHeaderPointerDown}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        className="mt-2 mb-4 text-[34px] leading-[38px] font-extrabold tracking-[-0.02em] text-balance select-none cursor-pointer"
        title="Tahan 2 detik untuk mode senyap"
      >
        {t("home.title")}
      </h1>
      {silentNotice && (
        <p role="status" aria-live="polite" className="mb-3 rounded-lg bg-asphalt-2 px-3 py-1.5 text-center text-sm font-semibold text-paint">
          {silentNotice}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {INCIDENTS.map((i) => (
          <IncidentTile
            key={i.id}
            id={i.id}
            label={i.label}
            selected={incident === i.id}
            dimmed={incident !== null && incident !== i.id}
            onToggle={() => setIncident(incident === i.id ? null : i.id)}
          />
        ))}
      </div>

      {!fix && hasAddress === false ? (
        <Link
          href="/profil?baru=1"
          aria-live="polite"
          className="mt-4 flex min-h-14 items-center gap-3 rounded-[12px] bg-sos px-4 text-[18px] leading-6 font-bold text-white"
        >
          <GpsIcon size={24} />
          {t("home.location.missing")}
        </Link>
      ) : (
        <p
          aria-live="polite"
          className="mt-4 flex min-h-14 items-center gap-3 rounded-[12px] bg-asphalt-2 px-4 text-[17px] leading-6 font-bold"
        >
          <span
            aria-hidden
            className={`size-3 shrink-0 rounded-full ${fix ? "bg-done" : error ? "bg-paint-muted" : "animate-pulse bg-signal"}`}
          />
          <span className="min-w-0 truncate">
            {fix ? t("home.location.ok", { m: fix.accuracy_m }) : address ? address : error ? t("home.location.none") : "Mencari lokasi…"}
          </span>
        </p>
      )}

      <div className="mt-auto pt-6">
        {err && <p role="alert" className="mb-2 font-bold text-signal">{err}</p>}
        <SosHoldButton disabled={busy} onComplete={start} doubleTap={doubleTap} />
      </div>
    </main>
  );
}
