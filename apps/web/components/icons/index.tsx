import type { ReactNode } from "react";

// Line icons in Tabler-like style: 2px stroke, round caps/joins, 24x24 grid.
// Paths are drawn in-house (no external copies). Colour follows currentColor.

type IconProps = { size?: number };

function Svg({ size = 24, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function FlameIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 3c1 3 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1 2.5 2 3 0-3 0-5.5 1-8.5z" />
    </Svg>
  );
}

function CarCrashIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 15v-3l2-4.5A2 2 0 0 1 7.8 6.3h8.4a2 2 0 0 1 1.8 1.2L20 12v3" />
      <path d="M3 15h18v3H3z" />
      <path d="M7 18v2M17 18v2" />
      <path d="M2 3l2 2M22 3l-2 2M12 1v2" />
    </Svg>
  );
}

function HeartbeatIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3 12h4l2-4 3 8 2-4h7" />
    </Svg>
  );
}

function PersonAlertIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-2a6 6 0 0 1 6-6h1" />
      <path d="M19 12v4" />
      <path d="M19 19v.01" />
    </Svg>
  );
}

function HouseAlertIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 11l6-5.5 6 5.5V20H4z" />
      <path d="M8 20v-4h2v4" />
      <path d="M19 9v5" />
      <path d="M19 17.5v.01" />
    </Svg>
  );
}

function WavesIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M2 8c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0" />
      <path d="M2 13c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0" />
      <path d="M2 18c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0" />
    </Svg>
  );
}

function FallbackIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16v.01" />
    </Svg>
  );
}

const INCIDENT_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  kebakaran: FlameIcon,
  kecelakaan: CarCrashIcon,
  sakit: HeartbeatIcon,
  kejahatan: PersonAlertIcon,
  kdrt: HouseAlertIcon,
  bencana: WavesIcon,
};

export function IncidentIcon({ id, size = 40 }: { id: string; size?: number }) {
  const Icon = INCIDENT_ICONS[id] ?? FallbackIcon;
  return <Icon size={size} />;
}

export function SosIcon({ size = 24 }: IconProps) {
  // Lifebuoy
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M5.6 5.6l3.5 3.5M18.4 5.6l-3.5 3.5M5.6 18.4l3.5-3.5M18.4 18.4l-3.5-3.5" />
    </Svg>
  );
}

export function GpsIcon({ size = 24 }: IconProps) {
  // Crosshair
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Svg>
  );
}

export function CheckIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function WaveIcon({ size = 24 }: IconProps) {
  // Three bars: "operator sedang bicara" indicator
  return (
    <Svg size={size}>
      <path d="M7 9v6M12 6v12M17 9v6" />
    </Svg>
  );
}

export function CloseIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}
