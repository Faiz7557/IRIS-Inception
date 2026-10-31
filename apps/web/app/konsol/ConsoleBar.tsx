"use client";
import Link from "next/link";
import type { ReactNode } from "react";

/** Asphalt top bar shared by the queue and the call screen. */
export function ConsoleBar({ connected, right }: { connected: boolean | null; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center gap-4 bg-asphalt px-6 text-paint">
      <Link href="/konsol" className="text-[19px] font-extrabold tracking-[-0.01em]">
        Jembatan 112 <span className="font-bold text-paint-muted">· Konsol operator</span>
      </Link>
      <span className="rounded-[6px] bg-signal px-2 text-[13px] leading-6 font-extrabold tracking-[0.06em] text-ink">SIMULASI</span>
      {connected !== null && (
        <span className="flex items-center gap-2 text-[15px] font-bold text-paint-muted" role="status">
          <span className={`size-2.5 rounded-full ${connected ? "bg-done" : "bg-sos"}`} aria-hidden />
          {connected ? "Tersambung" : "Terputus"}
        </span>
      )}
      <div className="ml-auto flex items-center gap-3">{right}</div>
    </header>
  );
}
