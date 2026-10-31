"use client";
import { CheckIcon } from "./icons";

export type StopState = "done" | "current" | "todo";
export interface Stop {
  label: string;
  sub?: string;
  state: StopState;
}

/**
 * The call drawn as an angkot route: stops fill in one at a time, top to bottom, in the incident's paint.
 * `compact` is the one-line strip shown above a question card.
 */
export function RouteBoard({ stops, paint, compact = false }: { stops: Stop[]; paint: { bg: string; fg: string }; compact?: boolean }) {
  const current = stops.find((s) => s.state === "current") ?? [...stops].reverse().find((s) => s.state === "done");

  if (compact) {
    return (
      <div className="rounded-[12px] bg-asphalt-2 px-3 pt-3 pb-2" aria-label={`Rute panggilan: ${current?.label ?? ""}`}>
        <ol className="flex items-center" aria-hidden>
          {stops.map((s, i) => (
            <li key={s.label} className="flex flex-1 items-center last:flex-none">
              <Dot state={s.state} paint={paint} small />
              {i < stops.length - 1 && <Segment on={s.state === "done"} paint={paint} horizontal />}
            </li>
          ))}
        </ol>
        <p className="mt-1.5 text-[15px] leading-6 font-bold text-paint-muted">{current?.label}</p>
      </div>
    );
  }

  return (
    <ol className="relative" aria-label="Rute panggilan">
      {stops.map((s, i) => (
        <li key={s.label} className="flex gap-4" aria-current={s.state === "current" ? "step" : undefined}>
          <div className="flex w-11 shrink-0 flex-col items-center">
            <Dot state={s.state} paint={paint} />
            {i < stops.length - 1 && <Segment on={s.state === "done"} paint={paint} />}
          </div>
          <div className={`pb-6 ${s.state === "current" ? "pt-1" : "pt-2"}`}>
            <p
              className={
                s.state === "current"
                  ? "text-[26px] leading-8 font-extrabold tracking-[-0.01em]"
                  : s.state === "done"
                    ? "text-[19px] leading-7 font-bold"
                    : "text-[19px] leading-7 font-bold text-paint-muted/80"
              }
            >
              {s.label}
              <span className="sr-only">{s.state === "done" ? " (sudah)" : s.state === "current" ? " (sekarang)" : " (belum)"}</span>
            </p>
            {s.sub && <p className="mt-1 text-[16px] leading-6 text-paint-muted">{s.sub}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Dot({ state, paint, small = false }: { state: StopState; paint: { bg: string; fg: string }; small?: boolean }) {
  const size = small ? "size-6" : state === "current" ? "size-11" : "size-9";
  if (state === "todo")
    return <span className={`${size} shrink-0 rounded-full border-[3px] border-dashed border-paint-muted/60`} />;
  return (
    <span
      className={`${size} relative flex shrink-0 items-center justify-center rounded-full`}
      style={{ background: paint.bg, color: paint.fg }}
    >
      {state === "done" && <CheckIcon size={small ? 14 : 20} />}
      {state === "current" && (
        <>
          <span className="absolute inset-0 animate-ping rounded-full opacity-40 motion-reduce:hidden" style={{ background: paint.bg }} />
          <span className={`${small ? "size-2" : "size-3.5"} rounded-full`} style={{ background: paint.fg }} />
        </>
      )}
    </span>
  );
}

function Segment({ on, paint, horizontal = false }: { on: boolean; paint: { bg: string }; horizontal?: boolean }) {
  const shape = horizontal ? "mx-1 h-1.5 flex-1" : "my-1 w-1.5 flex-1 min-h-6";
  return on ? (
    <span className={`${shape} rounded-full`} style={{ background: paint.bg }} />
  ) : (
    <span
      className={`${shape} ${horizontal ? "border-t-[3px]" : "border-l-[3px]"} border-dashed border-paint-muted/50`}
    />
  );
}
