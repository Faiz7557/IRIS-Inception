"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { vibrate } from "@/lib/geo";
import { t } from "@/lib/copy";

const HOLD_MS = 3000;
const R = 22;
const C = 2 * Math.PI * R;

/** Hold 3 s (pointer, or Space/Enter anywhere on the page) to fire onComplete. Progress ring + 3-2-1. */
export function SosHoldButton({ onComplete, disabled }: { onComplete: () => void; disabled?: boolean }) {
  const [p, setP] = useState(0); // 0..1
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const startRef = useRef(0);
  const raf = useRef(0);
  const lastSec = useRef(-1);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  const stop = useCallback((early: boolean) => {
    cancelAnimationFrame(raf.current);
    if (!startRef.current) return;
    startRef.current = 0;
    setHolding(false);
    setP(0);
    if (early && !doneRef.current) {
      setHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(false), 2000);
    }
  }, []);

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
    if (hintTimer.current) clearTimeout(hintTimer.current);
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
  const countdown = holding ? ["3", "2", "1"].slice(3 - left).join(" … ") : t("home.sos");

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
        style={{ touchAction: "none", background: holding ? "var(--color-sos-pressed)" : "var(--color-sos)" }}
        className="flex h-[88px] w-full select-none items-center justify-center gap-3 rounded-[12px] text-[24px] font-bold text-white disabled:opacity-60"
      >
        <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden>
          <circle cx="26" cy="26" r={R} fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth="5" />
          <circle
            cx="26" cy="26" r={R} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 26 26)"
          />
        </svg>
        <span>{countdown}</span>
      </button>
      <p id="sos-help" className="mt-2 text-center text-[16px] leading-6 text-[color:var(--color-text-muted)]">
        {hint ? t("home.sos.release_early") : keyboard ? "Tahan tombol ini, atau tahan Spasi, selama 3 detik." : "Tahan tombol ini selama 3 detik."}
      </p>
    </div>
  );
}
