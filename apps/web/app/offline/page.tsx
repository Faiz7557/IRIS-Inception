"use client";
import { useEffect, useState } from "react";
import { INCIDENTS } from "@/lib/incidents";
import { loadLocal, type LocalContact, type LocalProfile } from "@/lib/offline-store";

// TODO(integrator): T12 should write the last GPS fix to localStorage "j112_last_gps" as {"lat":..,"lng":..}.
function lastGps(): { lat: number; lng: number } | null {
  try {
    const g = JSON.parse(localStorage.getItem("j112_last_gps") ?? "null");
    return g && typeof g.lat === "number" && typeof g.lng === "number" ? g : null;
  } catch {
    return null;
  }
}

function buildSms(incidentId: string | null, p: LocalProfile | null, gps: { lat: number; lng: number } | null): string {
  const label = (INCIDENTS.find((i) => i.id === incidentId)?.label ?? "").toUpperCase();
  const who = p?.display_name ? `Saya ${p.display_name}` : "Saya";
  const addr = p?.address ? p.address + (p.landmark ? ` (${p.landmark})` : "") : "belum diketahui";
  const maps = gps ? `GPS: https://maps.google.com/?q=${gps.lat},${gps.lng}` : "GPS: tidak tersedia";
  return `DARURAT${label ? " " + label : ""}. ${who}, tuli, tidak bisa menelepon.\nLokasi: ${addr}. ${maps}\nTolong hubungi 112 untuk saya. (Jembatan 112)`;
}

export default function Offline() {
  const [text, setText] = useState("");
  const [contacts, setContacts] = useState<LocalContact[]>([]);
  const [online, setOnline] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const incident = new URLSearchParams(location.search).get("kejadian");
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    loadLocal().then(({ profile, contacts }) => {
      setContacts(contacts);
      setText(buildSms(incident, profile, lastGps()));
    });
    const up = () => setOnline(navigator.onLine);
    up();
    addEventListener("online", up);
    addEventListener("offline", up);
    return () => {
      removeEventListener("online", up);
      removeEventListener("offline", up);
    };
  }, []);

  const smsHref = (phone: string) => `sms:${phone}${ios ? "&" : "?"}body=${encodeURIComponent(text)}`;

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-4 p-6 text-[var(--color-text)]">
      <h1 className="text-3xl font-bold">Internet putus</h1>
      <p>Kirim SMS ke kontak darurat Anda. Teks sudah siap.</p>
      <pre className="whitespace-pre-wrap rounded-xl bg-[var(--color-surface)] p-4 font-sans">{text}</pre>
      {contacts.length === 0 && <p className="text-[var(--color-text-muted)]">Belum ada kontak tersimpan di ponsel ini. Telepon 112 bila bisa.</p>}
      {contacts.map((c) => (
        <a key={c.phone} href={smsHref(c.phone)} className="flex min-h-14 items-center justify-center rounded-xl bg-[var(--color-primary)] text-lg font-bold text-white">
          Buka SMS: {c.name}
        </a>
      ))}
      {online && (
        <button onClick={() => (location.href = "/")} className="min-h-14 w-full rounded-xl border-2 border-[var(--color-primary)] text-lg font-bold text-[var(--color-accent)]">
          Coba panggil lagi
        </button>
      )}
    </main>
  );
}
