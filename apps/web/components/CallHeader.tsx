"use client";
import { useEffect, useState } from "react";
import { t } from "@/lib/copy";
import { paintOf } from "@/lib/incidents";
import { IncidentIcon } from "./icons";

export type CallPhase = "dialing" | "connected" | "failed" | "ended";

/** The van's paint band: incident colour, icon and name, call clock, and the cancel control. */
export function CallHeader({
  phase, incident, startedAt, practice, onCancel,
}: {
  phase: CallPhase;
  incident: string;
  startedAt: number | null;
  practice: boolean;
  onCancel?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || phase !== "connected") return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [startedAt, phase]);
  const s = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const clock = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const p = phase === "failed" ? { bg: "var(--sos)", fg: "#fff", label: t("fallback.title") } : paintOf(incident);

  return (
    <header className="sticky top-0 z-40 bg-[color:var(--color-bg)] px-2 pt-2">
      <div style={{ background: p.bg, color: p.fg }} className="flex min-h-[80px] items-center gap-3 px-4">
        <IncidentIcon id={incident} size={32} />
        <div className="flex min-w-0 flex-1 flex-col" aria-live="polite">
          <span className="s-display truncate text-[26px] leading-7 font-black tracking-[-0.03em]">{p.label}</span>
          <span className="text-[15px] leading-5 font-semibold">
            {phase === "connected" ? <span className="font-mono tabular-nums">{clock}</span> : phase === "dialing" ? t("call.dialing") : null}
            {practice && <span className="s-tag ml-2 !min-h-0 !px-1.5 !py-0 !text-[12px]">LATIHAN</span>}
          </span>
        </div>
        {onCancel && phase !== "ended" && (
          <button type="button" onClick={onCancel} className="m-btn m-btn--sm m-btn--line shrink-0 !px-3.5">
            {t("call.cancel")}
          </button>
        )}
      </div>
    </header>
  );
}
