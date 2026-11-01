"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { loadLocal } from "./offline-store";

export interface GeoFix { lat: number; lng: number; accuracy_m: number; captured_at: string }

/** watchPosition per TRD §9. error is set when permission is denied/unavailable. */
export function useGeo(): { fix: GeoFix | null; error: string | null } {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setError("unsupported");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        try {
          localStorage.setItem("j112_last_gps", JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude }));
        } catch {
          /* storage blocked: /offline SMS says GPS unavailable */
        }
        setFix({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy_m: Math.round(p.coords.accuracy),
          captured_at: new Date(p.timestamp).toISOString(),
        });
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return { fix, error };
}

/** Silent mode = class `.silent` on <html> (set by the (pengguna) layout from profile). */
export const isSilent = () =>
  typeof document !== "undefined" && document.documentElement.classList.contains("silent");

/** Vibrate only where supported and not in silent mode. Never the only signal (iOS has none). */
export function vibrate(pattern: number | number[]) {
  if (!isSilent() && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
}

export interface Profile {
  display_name?: string;
  practice_mode?: boolean;
  silent_mode?: boolean;
  large_text?: boolean;
  [k: string]: unknown;
}

/**
 * GET /v1/me/profile; tolerates both `{profile: {...}}` and a bare profile. When the server is unreachable it
 * falls back to this device's copy (IndexedDB), marked `local: true`; null when neither exists.
 */
export async function loadProfile(): Promise<Profile | null> {
  try {
    // A slow network must not hold the home screen: after 4 s the local copy is good enough.
    const r = await Promise.race([
      api<{ profile?: Profile } & Profile>("/v1/me/profile"),
      new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 4000)),
    ]);
    return r.profile ?? r;
  } catch {
    const { profile } = await loadLocal();
    return profile ? { ...profile, local: true } : null;
  }
}

/** What the operator and the officer card can already use. Drives the home readiness strip. */
export interface Readiness { name: boolean; address: boolean; contacts: boolean; practiced: boolean }

export const PRACTICED_KEY = "j112.practiced";

export function hasPracticed(): boolean {
  try {
    return localStorage.getItem(PRACTICED_KEY) === "1";
  } catch {
    return false;
  }
}
