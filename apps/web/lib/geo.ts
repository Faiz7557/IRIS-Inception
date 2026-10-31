"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

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

/** GET /v1/me/profile; tolerates both `{profile: {...}}` and a bare profile. null on any failure. */
export async function loadProfile(): Promise<Profile | null> {
  try {
    const r = await api<{ profile?: Profile } & Profile>("/v1/me/profile");
    return r.profile ?? r;
  } catch {
    return null;
  }
}
