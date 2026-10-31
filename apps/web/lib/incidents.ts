import type { Incident } from "./protocol";

export const INCIDENTS: { id: Exclude<Incident, "umum">; label: string; colorVar: string; icon: string }[] = [
  {
    "id": "kebakaran",
    "label": "Kebakaran",
    "colorVar": "--incident-fire",
    "icon": "flame"
  },
  {
    "id": "kecelakaan",
    "label": "Kecelakaan",
    "colorVar": "--incident-crash",
    "icon": "car-crash"
  },
  {
    "id": "sakit",
    "label": "Sakit",
    "colorVar": "--incident-medical",
    "icon": "heartbeat"
  },
  {
    "id": "kejahatan",
    "label": "Kejahatan",
    "colorVar": "--incident-crime",
    "icon": "user-exclamation"
  },
  {
    "id": "kdrt",
    "label": "KDRT",
    "colorVar": "--incident-dv",
    "icon": "home-exclamation"
  },
  {
    "id": "bencana",
    "label": "Bencana",
    "colorVar": "--incident-disaster",
    "icon": "ripple"
  }
];
