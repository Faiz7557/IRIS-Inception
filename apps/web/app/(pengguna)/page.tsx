"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { INCIDENTS, paintOf } from "@/lib/incidents";
import { t } from "@/lib/copy";
import { hasPracticed, loadProfile, useGeo, vibrate } from "@/lib/geo";
import { loadLocal, saveLocalProfile } from "@/lib/offline-store";
import { deviceKey } from "@/lib/utils";
import type { CreateCall, Incident } from "@/lib/protocol";
import { IncidentTile } from "@/components/IncidentTile";
import { SosHoldButton } from "@/components/SosHoldButton";
import {
  ChevronIcon, GpsIcon, IdCardIcon, MenuIcon, MessageIcon, MoonIcon, SchoolIcon, UserIcon, UsersIcon,
} from "@/components/icons";

interface CallCreated {
  call_id: string;
  ws_url: string;
  ws_ticket: string;
  opener_text?: string;
  practice?: boolean;
}

/** One line of the readiness panel: what is ready, or a link that fixes what is missing. */
function ReadyRow({ ok, icon, text, fix, href }: { ok: boolean | null; icon: React.ReactNode; text: string; fix: string; href: string }) {
  if (ok === false)
    return (
      <Link href={href} className="flex min-h-11 items-center gap-3 font-semibold">
        <span className="text-[color:var(--color-sos)]">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        <span className="flex shrink-0 items-center text-[15px] font-extrabold underline underline-offset-4">
          {fix}
          <ChevronIcon size={18} />
        </span>
      </Link>
    );
  return (
    <p className={`flex min-h-11 items-center gap-3 font-semibold ${ok === null ? "text-text-muted" : ""}`}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </p>
  );
}

export default function BerandaPage() {
  const router = useRouter();
  const { fix, error } = useGeo();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [practice, setPractice] = useState(true); // default latihan until profile says otherwise
  const [address, setAddress] = useState<string | null>(null); // null = not loaded yet, "" = none
  const [name, setName] = useState<string | null>(null);
  const [contacts, setContacts] = useState<number | null>(null);
  const [practiced, setPracticed] = useState(true);
  const [silent, setSilent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doubleTap, setDoubleTap] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const headerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // App shortcut / deep link: /?kejadian=kebakaran preselects the plate.
    const k = new URLSearchParams(location.search).get("kejadian");
    if (INCIDENTS.some((i) => i.id === k)) setIncident(k as Incident);
    setSilent(document.documentElement.classList.contains("silent"));
    setPracticed(hasPracticed());
    loadProfile().then((p) => {
      setPractice(p?.practice_mode !== false);
      setAddress(typeof p?.address === "string" ? p.address.trim() : "");
      setName(typeof p?.display_name === "string" ? p.display_name.trim() : "");
      setDoubleTap(!!p?.double_tap_sos);
    });
    api<unknown[] | { contacts: unknown[] }>("/v1/me/contacts")
      .then((r) => setContacts((Array.isArray(r) ? r : r.contacts).length))
      .catch(() => loadLocal().then((l) => setContacts(l.contacts.length)));
    return () => {
      clearTimeout(headerTimer.current ?? undefined);
      clearTimeout(noticeTimer.current ?? undefined);
    };
  }, []);

  const say = (msg: string) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current ?? undefined);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  };

  const toggleSilent = useCallback(async () => {
    const next = !document.documentElement.classList.contains("silent");
    document.documentElement.classList.toggle("silent", next);
    setSilent(next);
    vibrate(50);
    say(next ? "Mode senyap aktif: layar gelap, tanpa getar." : "Mode senyap mati.");
    try {
      const p = await loadProfile();
      if (p && !p.local) {
        const updated = { ...p, silent_mode: next };
        await api("/v1/me/profile", { method: "PUT", body: JSON.stringify(updated) });
        await saveLocalProfile(updated as Parameters<typeof saveLocalProfile>[0]);
      }
    } catch {
      /* local toggle stays */
    }
  }, []);

  // Hidden shortcut kept from the first build: hold the title 2 s to toggle silent mode without looking.
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

  const picked = incident ? paintOf(incident).label : null;
  const where = fix
    ? t("home.location.ok", { m: fix.accuracy_m })
    : address
      ? `Alamat: ${address}`
      : address === "" && error
        ? "Lokasi belum ada"
        : "Mencari lokasi GPS…";

  return (
    <main className="s-instant mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-2">
      <div className="s-bar !px-0">
        <div className="flex items-center gap-2">
          <span className="s-word">J112</span>
          {practice ? <span className="m-chip">Latihan</span> : <span className="m-chip m-chip--live">Simulasi</span>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={toggleSilent} aria-pressed={silent} aria-label="Mode senyap" className="m-icon-btn">
            <MoonIcon size={22} />
          </button>
          <Link href="/pengaturan" className="m-icon-btn">
            <MenuIcon size={22} />
            Menu
          </Link>
        </div>
      </div>

      <h1
        onPointerDown={onHeaderPointerDown}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        className="s-display mt-1 text-[40px] leading-[42px] font-black tracking-[-0.035em] select-none"
      >
        {t("home.title")}
      </h1>
      <p className="mt-1 mb-4 text-[16px] leading-6 text-text-muted">
        {practice ? "Latihan: tidak menelepon 112 sungguhan." : "Tersambung ke konsol operator simulasi."}
      </p>
      {notice && (
        <p role="status" className="m-band mb-2 px-4 py-2 text-[16px] font-bold">
          {notice}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Jenis kejadian (boleh dilewati)">
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

      <section aria-label="Kesiapan" aria-live="polite" className="m-surface mt-2 px-4 py-2 text-[17px] leading-6">
        <ReadyRow ok={address === null && !fix ? null : !!fix || !!address} icon={<GpsIcon size={22} />} text={where} fix="Isi alamat" href="/profil" />
        <ReadyRow ok={name === null ? null : !!name} icon={<UserIcon size={22} />} text={name ? `Nama: ${name}` : name === null ? "Memeriksa profil…" : "Nama belum diisi"} fix="Isi" href="/profil" />
        <ReadyRow
          ok={contacts === null ? null : contacts > 0}
          icon={<UsersIcon size={22} />}
          text={contacts ? `${contacts} kontak darurat siap dikabari` : contacts === null ? "Memeriksa kontak…" : "Kontak belum ada"}
          fix="Tambah"
          href="/kontak"
        />
      </section>

      <nav aria-label="Aksi cepat" className="mt-2 grid grid-cols-3 gap-2">
        <Link href="/kartu" className="m-icon-btn m-press !min-h-16 flex-col !gap-1 !py-2 text-[15px]">
          <IdCardIcon size={24} />
          Kartu darurat
        </Link>
        <Link href="/latihan" className="m-icon-btn m-press relative !min-h-16 flex-col !gap-1 !py-2 text-[15px]">
          <SchoolIcon size={24} />
          Coba latihan
          {!practiced && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-[color:var(--color-sos)]" aria-label="belum dicoba" role="img" />}
        </Link>
        <Link href={`/offline?kejadian=${incident ?? "umum"}`} className="m-icon-btn m-press !min-h-16 flex-col !gap-1 !py-2 text-[15px]">
          <MessageIcon size={24} />
          SMS darurat
        </Link>
      </nav>

      <div className="s-dock mt-auto pt-4">
        {err && <p role="alert" className="mb-2 font-bold text-[color:var(--color-sos)]">{err}</p>}
        <SosHoldButton disabled={busy} onComplete={start} doubleTap={doubleTap} target={picked ?? "darurat umum"} />
      </div>
    </main>
  );
}
