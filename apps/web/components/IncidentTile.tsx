"use client";
import { IncidentIcon, CheckIcon } from "./icons";
import { paintOf } from "@/lib/incidents";

/** One flat Sill panel in the incident's paint. Selected = thick ink frame + check; the others dim. */
export function IncidentTile({
  id, label, selected, dimmed, onToggle, order = 0,
}: { id: string; label: string; selected: boolean; dimmed: boolean; onToggle: () => void; order?: number }) {
  const p = paintOf(id);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={(e) => {
        onToggle();
        // Mouse/touch pick (detail > 0): drop focus so the next Space goes to SOS instead of un-picking this tile.
        // Keyboard users (Tab + Space, detail 0) keep focus here.
        if (e.detail > 0) e.currentTarget.blur();
      }}
      style={{ background: p.bg, color: p.fg, "--i": order } as React.CSSProperties}
      className={`s-open relative flex h-[112px] flex-col justify-between p-3.5 text-left transition-[opacity,box-shadow] duration-200 ease-out ${
        selected ? "shadow-[inset_0_0_0_5px_var(--ink-dark)]" : ""
      } ${dimmed ? "opacity-60" : ""}`}
    >
      <IncidentIcon id={id} size={34} />
      <span className="s-display text-[22px] leading-6 font-extrabold tracking-[-0.02em]">{label}</span>
      {selected && (
        <span className="absolute top-3 right-3 flex size-8 items-center justify-center bg-[var(--ink-dark)] text-[var(--paint-general)]" aria-hidden>
          <CheckIcon size={20} />
        </span>
      )}
    </button>
  );
}
