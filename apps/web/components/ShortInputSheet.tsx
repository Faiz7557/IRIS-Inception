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
      className="fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[60dvh] max-w-[480px] flex-col gap-3 rounded-t-[16px] bg-[color:var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[24px] font-bold">Ketik singkat</h2>
        <button type="button" onClick={onClose} className="min-h-[56px] min-w-[56px] font-bold text-[color:var(--color-accent)]">
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
              className="min-h-[56px] rounded-full border-2 border-[color:var(--color-primary)] px-4 text-[16px]"
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
        className="min-h-[56px] rounded-[12px] border-2 border-[color:var(--color-text-muted)] bg-transparent px-3 text-[18px]"
      />
      <div className="text-right text-[16px] text-[color:var(--color-text-muted)]" aria-live="polite">
        {v.length}/{MAX}
      </div>
      <button
        type="button"
        disabled={!clean}
        onClick={() => onSend(clean)}
        className="mt-auto min-h-[56px] rounded-[12px] bg-[color:var(--color-primary)] font-bold text-white disabled:opacity-40"
      >
        Kirim
      </button>
    </div>
  );
}
