"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { vibrate } from "@/lib/geo";
import { t } from "@/lib/copy";

const HOLD_MS = 3000;

/** Hold 3 s (pointer, or Space/Enter anywhere on the page) to fire onComplete. Progress ring + 3-2-1. */
export function SosHoldButton({
  onComplete,
  disabled,
  doubleTap,
  target,
}: {
  onComplete: () => void;
  disabled?: boolean;
  doubleTap?: boolean;
  /** What the call is for, shown under the label so the pick is confirmed under the thumb. */
  target?: string;
}) {
  const [p, setP] = useState(0); // 0..1
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const startRef = useRef(0);
  const raf = useRef(0);
  const lastSec = useRef(-1);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);
  const lastTapRef = useRef(0);
  const stop = useCallback((early: boolean) => {
    cancelAnimationFrame(raf.current);
    const holdDuration = startRef.current ? performance.now() - startRef.current : 0;
    if (!startRef.current) return;
    startRef.current = 0;
    setHolding(false);
    setP(0);
    if (early && !doneRef.current) {
      if (doubleTap && holdDuration < 300) {
        const now = performance.now();
        if (now - lastTapRef.current < 450) {
          lastTapRef.current = 0;
          doneRef.current = true;
          vibrate([40, 50, 40]);
          onComplete();
          return;
        }
        lastTapRef.current = now;
      }
      setHint(true);
      clearTimeout(hintTimer.current ?? undefined);
      hintTimer.current = setTimeout(() => setHint(false), 2000);
    }
  }, [doubleTap, onComplete]);
  const tick = useCallback(() => {
    const el = performance.now() - startRef.current;
    const sec = Math.floor(el / 1000);
    if (sec !== lastSec.current) {
      lastSec.current = sec;
      vibrate(30);
    }
    if (el >= HOLD_MS) {
      doneRef.current = true;
      stop(false);
      onComplete();
      return;
    }
    setP(el / HOLD_MS);
    raf.current = requestAnimationFrame(tick);
  }, [onComplete, stop]);

  const start = useCallback(() => {
    if (disabled || startRef.current) return;
    doneRef.current = false;
    lastSec.current = -1;
    startRef.current = performance.now();
    setHolding(true);
    setHint(false);
    raf.current = requestAnimationFrame(tick);
  }, [disabled, tick]);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    clearTimeout(hintTimer.current ?? undefined);
  }, []);

  // Keyboard hold works from page load: on first visit focus is on <body>, not on this button.
  // Only when nothing else has focus, so Space/Enter still work normally on tiles, links and inputs.
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const isKey = (e: KeyboardEvent) => e.key === " " || e.key === "Enter";
    const ours = () => {
      const a = document.activeElement;
      return !a || a === document.body || a === document.documentElement || a === btn.current;
    };
    const down = (e: KeyboardEvent) => {
      if (!isKey(e) || !ours()) return;
      e.preventDefault(); // also stops Space from scrolling the page
      if (!e.repeat) start();
    };
    const up = (e: KeyboardEvent) => {
      if (isKey(e) && ours()) stop(true);
    };
    const lost = () => stop(true);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", lost);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", lost);
    };
  }, [start, stop]);

  // Touch phones only hold the screen; the Space/Enter hint is for devices with a keyboard and mouse.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => setKeyboard(window.matchMedia("(pointer: fine)").matches), []);

  const left = Math.max(1, Math.ceil(3 - p * 3));

  return (
    <div>
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        aria-describedby="sos-help"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start();
        }}
        onPointerUp={() => stop(true)}
        onPointerCancel={() => stop(true)}
        onContextMenu={(e) => e.preventDefault()}
        onBlur={() => stop(true)}
        style={{ touchAction: "none", background: "var(--sos)" }}
        className="relative isolate flex h-[104px] w-full select-none items-center gap-4 overflow-hidden px-5 text-left text-white disabled:opacity-60"
      >
        {/* The template's button arch, slowed to the hold: it rises from the bottom and fills the bar at 3 s. */}
        <span
          aria-hidden
          className="absolute -inset-x-[12%] top-0 -z-10 h-[150%] rounded-[50%_50%_0_0/34%_34%_0_0] bg-[var(--sos-pressed)]"
          style={{ transform: `translateY(${(1 - p) * 101}%)` }}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="s-display text-[34px] leading-9 font-black tracking-[-0.03em] whitespace-nowrap">{holding ? "Terus tahan…" : t("home.sos")}</span>
          <span className="truncate text-[16px] leading-6 font-semibold text-white/90">{disabled ? "Menghubungkan…" : `Panggil 112 · ${target ?? "darurat umum"}`}</span>
        </span>
        {holding && (
          <span aria-hidden className="s-display shrink-0 text-[64px] leading-none font-black tabular-nums">{left}</span>
        )}
      </button>
      <p id="sos-help" className={`mt-2 text-center text-[16px] leading-6 ${hint ? "font-bold text-[color:var(--color-sos)]" : "text-text-muted"}`}>
        {hint
          ? t("home.sos.release_early")
          : doubleTap
          ? "Ketuk 2× cepat atau tahan 3 detik."
          : keyboard
          ? "Atau tahan tombol Spasi selama 3 detik."
          : "Tahan sampai warna merah tua penuh."}
      </p>
    </div>
  );
}
