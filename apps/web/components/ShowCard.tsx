"use client";
import { useEffect, useRef, useState } from "react";
import { CloseIcon, IncidentIcon } from "./icons";

/**
 * Full-screen card to turn the phone towards an officer or a bystander: one huge line, a few facts beneath.
 * Used by the call screen ("Tunjukkan ke petugas") and the Kartu Darurat page (card and quick phrases).
 */
export function ShowCard({
  title, lines = [], incident, paint, onClose,
}: {
  title: string;
  lines?: string[];
  incident?: string;
  paint: { bg: string; fg: string };
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [flip, setFlip] = useState(false); // upside down, for the person across the table
  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ background: paint.bg, color: paint.fg }}
      className="fixed inset-0 z-50 flex flex-col justify-center gap-5 overflow-y-auto p-7 pt-20"
    >
      <button
        type="button"
        aria-pressed={flip}
        onClick={() => setFlip(!flip)}
        className="absolute top-3 left-3 flex min-h-14 items-center px-4 text-[18px] font-bold shadow-[inset_0_0_0_2px_currentColor]"
      >
        Putar
      </button>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 flex min-h-14 items-center gap-2 px-4 text-[18px] font-bold shadow-[inset_0_0_0_2px_currentColor]"
      >
        <CloseIcon size={26} />
        Tutup
      </button>
      <div className={`flex flex-col gap-5 transition-transform duration-200 ${flip ? "rotate-180" : ""}`}>
      {incident && <IncidentIcon id={incident} size={72} />}
      <p className="s-display text-[clamp(44px,14vw,72px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className={i === 0 ? "text-[30px] leading-9 font-bold" : "text-[22px] leading-8"}>
          {l}
        </p>
      ))}
      </div>
    </div>
  );
}
