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

export function MenuIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function ChevronIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function UserIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  );
}

export function UsersIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3 5.5" />
    </Svg>
  );
}

export function HistoryIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
      <path d="M3.5 4v4.5H8M12 8v4l3 2" />
    </Svg>
  );
}

export function MoonIcon({ size = 24 }: IconProps) {
  // Silent mode
  return (
    <Svg size={size}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
    </Svg>
  );
}

export function IdCardIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16a3 3 0 0 1 6 0M15 10h3M15 13h3" />
    </Svg>
  );
}

export function SchoolIcon({ size = 24 }: IconProps) {
  // Practice: a play triangle in a square
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M10 8.5v7l5.5-3.5z" />
    </Svg>
  );
}

export function MessageIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </Svg>
  );
}

export function PhoneIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />
    </Svg>
  );
}

export function CopyIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </Svg>
  );
}

export function ShareIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" />
      <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
    </Svg>
  );
}

export function TrashIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  );
}

export function PlusIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function ArrowLeftIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  );
}

export function HomeIcon({ size = 24 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" />
    </Svg>
  );
}
