"use client";
import { useEffect, useRef, useState } from "react";

const MAX = 80;

/** Bottom sheet (a square Sill panel) for "Tulis patokan" / "Ketik singkat". Closing keeps the card active. */
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
      className="fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[60dvh] max-w-[480px] flex-col gap-3 border-t-[6px] border-[color:var(--color-text)] bg-surface p-[18px] text-text shadow-[0_-10px_30px_rgb(0_0_0/0.25)]"
    >
      <div className="flex items-center justify-between">
        <h2 className="s-h2">Ketik singkat</h2>
        <button type="button" onClick={onClose} className="m-btn m-btn--sm m-btn--line">
          Tutup
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setV(s.slice(0, MAX))} className="m-btn m-btn--sm m-btn--line">
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
        className="m-field"
      />
      <div className="text-right text-[16px] text-text-muted" aria-live="polite">
        {v.length}/{MAX}
      </div>
      <button type="button" disabled={!clean} onClick={() => onSend(clean)} className="m-btn mt-auto w-full">
        Kirim
      </button>
    </div>
  );
}
