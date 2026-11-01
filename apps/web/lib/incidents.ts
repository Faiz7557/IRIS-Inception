import type { Incident } from "./protocol";

/** Route paint per incident. `ink` is the text/icon colour that passes AA on that paint. */
export const INCIDENTS: { id: Exclude<Incident, "umum">; label: string; colorVar: string; ink: "dark" | "light"; icon: string }[] = [
  { id: "kebakaran", label: "Kebakaran", colorVar: "--incident-fire", ink: "dark", icon: "flame" },
  { id: "kecelakaan", label: "Kecelakaan", colorVar: "--incident-crash", ink: "dark", icon: "car-crash" },
  { id: "sakit", label: "Sakit", colorVar: "--incident-medical", ink: "dark", icon: "heartbeat" },
  { id: "kejahatan", label: "Kejahatan", colorVar: "--incident-crime", ink: "light", icon: "user-exclamation" },
  { id: "kdrt", label: "KDRT", colorVar: "--incident-dv", ink: "dark", icon: "home-exclamation" },
  { id: "bencana", label: "Bencana", colorVar: "--incident-disaster", ink: "dark", icon: "ripple" },
];

/** Paint + ink for any incident id, including "umum" (white paint, dark ink). */
export function paintOf(id: string | null | undefined): { bg: string; fg: string; label: string } {
  const i = INCIDENTS.find((x) => x.id === id);
  if (!i) return { bg: "var(--paint-general)", fg: "var(--ink-dark)", label: "Darurat" };
  return { bg: `var(${i.colorVar})`, fg: i.ink === "dark" ? "var(--ink-dark)" : "var(--ink-light)", label: i.label };
}
