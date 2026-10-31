"use client";
import { IncidentIcon, CheckIcon } from "./icons";
import { paintOf } from "@/lib/incidents";

/** One route-paint plate. Selected = white paint outline + check, like a marked stop. */
export function IncidentTile({
  id, label, selected, dimmed, onToggle,
}: { id: string; label: string; selected: boolean; dimmed: boolean; onToggle: () => void }) {
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
      style={{ background: p.bg, color: p.fg }}
      className={`relative flex h-[120px] flex-col justify-between rounded-[14px] p-3.5 text-left transition-[opacity,transform,box-shadow] duration-200 ease-out active:scale-[0.97] ${
        selected ? "shadow-[0_0_0_4px_var(--paint-white),0_8px_20px_rgb(0_0_0/0.5)]" : ""
      } ${dimmed ? "opacity-60" : ""}`}
    >
      <IncidentIcon id={id} size={36} />
      <span className="text-[21px] leading-6 font-extrabold tracking-[-0.01em]">{label}</span>
      {selected && (
        <span className="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-full bg-paint text-ink" aria-hidden>
          <CheckIcon size={20} />
        </span>
      )}
    </button>
  );
}
