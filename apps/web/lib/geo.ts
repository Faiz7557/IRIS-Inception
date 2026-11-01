"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { loadLocal } from "./offline-store";

export interface GeoFix { lat: number; lng: number; accuracy_m: number; captured_at: string }

export type GeoPermission = "granted" | "prompt" | "denied" | "unknown";

/**
 * watchPosition per TRD §9. error is set when permission is denied/unavailable.
 * `auto: false` (home screen) only starts watching when permission is already granted, so the browser prompt
 * never pops up unexplained; `request()` starts it from the "Izinkan lokasi" button.
 */
export function useGeo(auto = true): {
  fix: GeoFix | null; error: string | null; perm: GeoPermission; request: () => void;
} {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perm, setPerm] = useState<GeoPermission>("unknown");
  const [on, setOn] = useState(auto);

  useEffect(() => {
    if (auto) return;
    let status: PermissionStatus | null = null;
    const read = () => {
      const st = (status?.state ?? "prompt") as GeoPermission;
      setPerm(st);
      if (st === "granted") setOn(true);
    };
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((s) => {
        status = s;
        read();
        s.onchange = read;
      })
      .catch(() => setPerm("prompt"));
    if (!navigator.permissions) setPerm("prompt");
    return () => {
      if (status) status.onchange = null;
    };
  }, [auto]);

  useEffect(() => {
    if (!on) return;
    if (!("geolocation" in navigator)) {
      setError("unsupported");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setPerm("granted");
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
      (e) => {
        setError(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable");
        if (e.code === e.PERMISSION_DENIED) setPerm("denied");
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on]);

  return { fix, error, perm, request: () => setOn(true) };
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
