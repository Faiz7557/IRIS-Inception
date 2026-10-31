"use client";
import { useEffect, useState } from "react";
import { t } from "@/lib/copy";
import { WaveIcon } from "./icons";

export type CallPhase = "dialing" | "connected" | "failed" | "ended";
const BG: Record<CallPhase, string> = {
  dialing: "#1e293b",
  connected: "var(--color-primary)",
  failed: "#b91c1c",
  ended: "#475569",
};

export function CallHeader({
  phase, attempt, maxAttempts, startedAt, practice, speaking, onCancel,
}: {
  phase: CallPhase;
  attempt: number;
  maxAttempts: number;
  startedAt: number | null;
  practice: boolean;
  speaking: boolean;
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
  const text =
    phase === "dialing" ? t("call.dialing")
    : phase === "connected" ? t("call.connected")
    : phase === "failed" ? t("fallback.title")
    : "Selesai";

  return (
    <header className="sticky top-0 z-40">
      {practice && (
        <div className="bg-[#fde047] px-4 py-1 text-center text-[16px] font-bold leading-6 text-[#422006]">
          {t("practice.banner")}
        </div>
      )}
      <div style={{ background: BG[phase] }} className="flex h-[64px] items-center gap-3 px-4 text-white">
        <div aria-live="polite" className="flex min-w-0 flex-1 items-center gap-2 font-bold">
          <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full bg-white ${phase === "dialing" ? "animate-pulse" : ""}`} />
          <span className="truncate">{text}</span>
          {phase === "connected" && <span className="font-mono">{clock}</span>}
          {phase === "dialing" && (
            <span className="text-[16px] font-normal">{`${attempt}/${maxAttempts}`}</span>
          )}
        </div>
        {speaking && phase === "connected" && (
          <span className="flex items-center gap-1 text-[16px]">
            <WaveIcon size={24} />
            <span>{t("call.operator_speaking")}</span>
          </span>
        )}
        {onCancel && phase !== "ended" && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[56px] min-w-[56px] rounded-[12px] border-2 border-white px-3 font-bold"
          >
            {t("call.cancel")}
          </button>
        )}
      </div>
    </header>
  );
}
