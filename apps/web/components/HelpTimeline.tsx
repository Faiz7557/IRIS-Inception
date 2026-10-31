"use client";
import { useEffect, useState } from "react";
import type { TimelineData } from "@/lib/protocol";
import { t } from "@/lib/copy";
import { CheckIcon } from "./icons";

const STEPS: { key: keyof TimelineData; label: string }[] = [
  { key: "answered_at", label: "Panggilan diterima" },
  { key: "location_confirmed_at", label: "Lokasi dikonfirmasi" },
  { key: "dispatched_at", label: "Petugas berangkat" },
  { key: "contacts_notified_at", label: "Kontak darurat tahu" },
];

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} dtk lalu` : `${Math.floor(s / 60)} mnt lalu`;
}

export function HelpTimeline({ timeline, onShow }: { timeline: TimelineData; onShow: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(i);
  }, []);
  return (
    <section aria-labelledby="help-title" className="space-y-4">
      <h2 id="help-title" className="text-[32px] font-bold leading-10">{t("help.title")}</h2>
      <ol>
        {STEPS.map(({ key, label }, i) => {
          const at = timeline[key];
          return (
            <li key={key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full ${
                    at ? "bg-[color:var(--color-primary)] text-white" : "border-2 border-dashed border-[color:var(--color-text-muted)]"
                  }`}
                >
                  {at && <CheckIcon size={16} />}
                </span>
                {i < STEPS.length - 1 && (
                  <span className={`my-1 h-6 border-l-2 ${at ? "border-[color:var(--color-primary)]" : "border-dashed border-[color:var(--color-text-muted)]"}`} />
                )}
              </div>
              <div className={at ? "" : "text-[color:var(--color-text-muted)]"}>
                {label}
                {at ? (
                  <span className="ml-2 text-[16px] text-[color:var(--color-text-muted)]">{ago(at, now)}</span>
                ) : (
                  <span className="sr-only"> (belum)</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="rounded-[12px] bg-[color:var(--color-warning-bg)] p-3 text-[color:var(--color-warning)]">
        {t("help.stay_safe")}
      </p>
      <button
        type="button"
        onClick={onShow}
        className="min-h-[56px] w-full rounded-[12px] border-2 border-[color:var(--color-primary)] font-bold text-[color:var(--color-accent)]"
      >
        Tunjukkan ke petugas
      </button>
    </section>
  );
}
