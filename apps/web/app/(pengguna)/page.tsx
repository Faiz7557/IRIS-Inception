"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { INCIDENTS } from "@/lib/incidents";
import { t } from "@/lib/copy";
import { loadProfile, useGeo } from "@/lib/geo";
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadProfile().then((p) => p && setPractice(p.practice_mode !== false));
  }, []);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    if (!navigator.onLine) return void router.push("/offline");
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
        // TODO(integrator): ApiError drops extra body fields; 409 id is read from the message if present.
        const id = e.status === 409 ? /[0-9a-f]{8}-[0-9a-f-]{27}/i.exec(e.message)?.[0] : null;
        if (id) return void router.push(`/panggilan/${id}`);
        setErr(e.status === 409 ? "Panggilan sebelumnya masih berjalan." : e.status === 429 ? "Terlalu sering. Coba lagi nanti." : e.message);
        setBusy(false);
      } else {
        router.push("/offline"); // network failure or 5 s timeout
      }
    } finally {
      clearTimeout(timer);
    }
  }, [busy, fix, incident, practice, router]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      {practice && (
        <div className="bg-[#fde047] px-4 py-1 text-center text-[16px] font-bold leading-6 text-[#422006]">
          {t("practice.banner")}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-[24px] font-bold text-[color:var(--color-navy)]">{t("home.title")}</h1>
          <Link href="/pengaturan" aria-label="Pengaturan" className="flex min-h-[44px] min-w-[44px] items-center justify-center font-bold text-[color:var(--color-accent)]">
            Atur
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {INCIDENTS.map((i) => (
            <IncidentTile
              key={i.id}
              id={i.id}
              label={i.label}
              colorVar={i.colorVar}
              selected={incident === i.id}
              onToggle={() => setIncident(incident === i.id ? null : i.id)}
            />
          ))}
        </div>

        <p
          aria-live="polite"
          className={`flex items-center gap-2 text-[18px] ${error ? "font-bold text-[color:var(--color-sos)]" : ""}`}
        >
          <GpsIcon size={24} />
          {fix ? t("home.location.ok", { m: fix.accuracy_m }) : error ? t("home.location.none") : "Mencari lokasi…"}
        </p>

        <div className="mt-auto">
          {err && <p role="alert" className="mb-2 font-bold text-[color:var(--color-sos)]">{err}</p>}
          <SosHoldButton disabled={busy} onComplete={start} />
        </div>
      </div>
    </main>
  );
}
