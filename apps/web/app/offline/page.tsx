"use client";
import { useEffect, useState } from "react";
import { INCIDENTS } from "@/lib/incidents";
import { t } from "@/lib/copy";
import { PageHead } from "@/components/PageHead";
import { loadLocal, type LocalContact, type LocalProfile } from "@/lib/offline-store";
import Link from "next/link";
import { IdCardIcon, MessageIcon, ShareIcon } from "@/components/icons";

// Written by lib/geo.ts useGeo on every fix.
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
  const [copied, setCopied] = useState(false);
  // Any messenger works when no contact is saved: the system share sheet, or the clipboard as a last resort.
  const shareText = async () => {
    try {
      if (navigator.share) return await navigator.share({ text });
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* share sheet dismissed */
    }
  };

  return (
    <main className="min-h-dvh text-[var(--color-text)]">
      <PageHead title={online ? "SMS darurat" : t("offline.title")} lead="Kirim SMS ke kontak darurat Anda. Teks sudah siap." back="/" tone="orange" />
      <div className="s-page">
        <div className="s-panel m-surface" style={{ "--i": 1 } as React.CSSProperties}>
          <p className="m-label">Teks SMS</p>
          <pre className="whitespace-pre-wrap font-sans text-[17px] leading-7">{text}</pre>
        </div>
        {contacts.length === 0 && <p className="s-panel m-surface text-[var(--color-text-muted)]">Belum ada kontak tersimpan di ponsel ini. Bagikan teks ini ke siapa saja, atau minta orang di sekitar menelepon 112.</p>}
        {contacts.map((c) => (
          <a key={c.phone} href={smsHref(c.phone)} className="m-btn w-full">
            <MessageIcon size={22} />
            Kirim SMS ke {c.name}
          </a>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={shareText} className="m-btn m-btn--line">
            <ShareIcon size={22} />
            {copied ? "Disalin" : "Bagikan"}
          </button>
          <Link href="/kartu" className="m-btn m-btn--line">
            <IdCardIcon size={22} />
            Kartu
          </Link>
        </div>
        {online && (
          <button onClick={() => (location.href = "/")} className="m-btn m-btn--line w-full">
            Coba panggil lagi
          </button>
        )}
      </div>
    </main>
  );
}
