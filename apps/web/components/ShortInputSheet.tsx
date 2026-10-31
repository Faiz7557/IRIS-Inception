"use client";
import { useEffect, useRef, useState } from "react";

const MAX = 80;

/** Bottom sheet for "Tulis patokan" / "Ketik singkat". Always optional: closing keeps the card active. */
export function ShortInputSheet({
  suggestions, onSend, onClose,
}: {
  suggestions: string[];
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const clean = v.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ketik singkat"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[60dvh] max-w-[480px] flex-col gap-3 rounded-t-[18px] border-t-4 border-paint bg-asphalt-2 p-4 shadow-[0_-10px_30px_rgb(0_0_0/0.5)]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[26px] font-extrabold">Ketik singkat</h2>
        <button type="button" onClick={onClose} className="min-h-14 min-w-14 font-bold text-signal">
          Tutup
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setV(s.slice(0, MAX))}
              className="min-h-14 rounded-[12px] border-[3px] border-paint/60 px-4 text-[17px] font-bold"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <input
        ref={ref}
        value={v}
        maxLength={MAX}
        onChange={(e) => setV(e.target.value)}
        aria-label="Pesan singkat"
        enterKeyHint="send"
        onKeyDown={(e) => e.key === "Enter" && clean && onSend(clean)}
        className="min-h-14 rounded-[12px] border-[3px] border-paint-muted/60 bg-asphalt px-3 text-[19px] focus:border-signal"
      />
      <div className="text-right text-[16px] text-paint-muted" aria-live="polite">
        {v.length}/{MAX}
      </div>
      <button
        type="button"
        disabled={!clean}
        onClick={() => onSend(clean)}
        className="mt-auto min-h-16 rounded-[12px] bg-paint text-[20px] font-extrabold text-ink disabled:opacity-40"
      >
        Kirim
      </button>
    </div>
  );
}
