"use client";
import { IncidentIcon, CheckIcon } from "./icons";

export function IncidentTile({
  id, label, colorVar, selected, onToggle,
}: { id: string; label: string; colorVar: string; selected: boolean; onToggle: () => void }) {
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
      style={{ background: `var(${colorVar})` }}
      className={`relative flex min-h-[112px] min-w-[148px] flex-col items-center justify-center gap-2 rounded-[16px] text-white ${
        selected ? "ring-4 ring-inset ring-white" : ""
      }`}
    >
      <IncidentIcon id={id} size={40} />
      <span className="text-[18px] font-bold leading-6">{label}</span>
      {selected && (
        <span className="absolute right-2 top-2" aria-hidden>
          <CheckIcon size={24} />
        </span>
      )}
    </button>
  );
}
