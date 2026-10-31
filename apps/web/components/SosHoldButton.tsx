"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { vibrate } from "@/lib/geo";
import { t } from "@/lib/copy";

const HOLD_MS = 3000;
const R = 22;
const C = 2 * Math.PI * R;

/** Hold 3 s (pointer, or Space/Enter anywhere on the page) to fire onComplete. Progress ring + 3-2-1. */
export function SosHoldButton({
  onComplete,
  disabled,
  doubleTap,
}: {
  onComplete: () => void;
  disabled?: boolean;
  doubleTap?: boolean;
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
        style={{ touchAction: "none", background: holding ? "var(--sos-pressed)" : "var(--sos)" }}
        className="relative flex h-[104px] w-full select-none items-center gap-4 overflow-hidden rounded-[18px] px-5 text-left text-white shadow-[0_10px_28px_rgb(224_38_27/0.35)] disabled:opacity-60"
      >
        {/* The route being driven: white paint fills the bar left to right while held. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-white/18"
          style={{ width: `${p * 100}%` }}
        />
        <svg width="58" height="58" viewBox="0 0 52 52" aria-hidden className="relative shrink-0">
          <circle cx="26" cy="26" r={R} fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth="5" />
          <circle
            cx="26" cy="26" r={R} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 26 26)"
          />
          {holding && (
            <text x="26" y="34" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800">{left}</text>
          )}
        </svg>
        <span className="relative flex flex-col">
          <span className="text-[26px] leading-8 font-extrabold tracking-[-0.01em] whitespace-nowrap">{holding ? "Terus tahan…" : t("home.sos")}</span>
          <span className="text-[16px] leading-6 text-white/90">untuk memanggil 112</span>
        </span>
      </button>
      <p id="sos-help" className={`mt-2 text-center text-[16px] leading-6 ${hint ? "font-bold text-signal" : "text-paint-muted"}`}>
        {hint
          ? t("home.sos.release_early")
          : doubleTap
          ? "Ketuk 2× cepat atau tahan 3 detik."
          : keyboard
          ? "Atau tahan tombol Spasi selama 3 detik."
          : "Tahan sampai lingkaran penuh."}
      </p>
    </div>
  );
}
