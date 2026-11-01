"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { loadProfile, type Profile } from "@/lib/geo";
import { loadLocal, type LocalContact } from "@/lib/offline-store";
import { PageHead } from "@/components/PageHead";
import { ShowCard } from "@/components/ShowCard";
import { IdCardIcon, MessageIcon, PhoneIcon } from "@/components/icons";

// Things a deaf person most often needs to say to someone standing next to them. Short, one idea each.
const PHRASES = [
  "Tolong panggil ambulans.",
  "Tolong telepon 112 untuk saya.",
  "Saya tuli. Tolong tulis di ponsel.",
  "Saya butuh bantuan.",
  "Saya tidak terluka.",
  "Di mana saya sekarang?",
];

const INK = { bg: "var(--ink-dark)", fg: "var(--paint-general)" };
const CARD = { bg: "var(--sill-mustard)", fg: "var(--ink-dark)" };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Kartu Darurat: the officer card, a "papan tulis" of quick phrases, and contacts a bystander can call. */
export default function KartuPage() {
  const [p, setP] = useState<Profile | null>(null);
  const [contacts, setContacts] = useState<LocalContact[]>([]);
  const [show, setShow] = useState<{ title: string; lines: string[]; paint: { bg: string; fg: string } } | null>(null);
  const [own, setOwn] = useState("");

  useEffect(() => {
    loadProfile().then(setP);
    api<LocalContact[] | { contacts: LocalContact[] }>("/v1/me/contacts")
      .then((r) => setContacts(Array.isArray(r) ? r : r.contacts))
      .catch(() => loadLocal().then((l) => setContacts(l.contacts)));
  }, []);

  const name = str(p?.display_name);
  const address = [str(p?.address), str(p?.landmark) && `(${str(p?.landmark)})`].filter(Boolean).join(" ");
  const facts = [
    name && `Nama: ${name}`,
    address && `Alamat: ${address}`,
    str(p?.blood_type) && `Golongan darah: ${str(p?.blood_type)}`,
    str(p?.medical_notes) && `Kondisi medis: ${str(p?.medical_notes)}`,
  ].filter(Boolean) as string[];

  return (
    <main className="text-[var(--color-text)]">
      <PageHead title="Kartu darurat" lead="Tunjukkan layar ini ke petugas atau orang di sekitar Anda." back="/" tone="mustard" />
      <div className="s-page">
        <section className="s-panel m-surface space-y-4" aria-labelledby="kartu-title" style={{ "--i": 1 } as React.CSSProperties}>
          <h2 id="kartu-title" className="m-label">Isi kartu</h2>
          <p className="s-display text-[30px] leading-8 font-black tracking-[-0.03em]">Saya tuli. Tolong bantu saya.</p>
          {facts.length ? (
            <ul className="space-y-1 text-[18px] leading-7">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : (
            <p className="text-text-muted">Nama dan alamat belum diisi. Kartu tetap bisa dipakai.</p>
          )}
          <button
            type="button"
            className="m-btn w-full"
            onClick={() => setShow({ title: "Saya tuli. Tolong bantu saya.", lines: facts, paint: CARD })}
          >
            <IdCardIcon size={24} />
            Tunjukkan kartu
          </button>
          <Link href="/profil" className="m-link text-[16px]">Ubah isi kartu di profil</Link>
        </section>

        <section className="s-panel m-surface space-y-3" aria-labelledby="papan-title" style={{ "--i": 2 } as React.CSSProperties}>
          <h2 id="papan-title" className="s-h2">Papan tulis</h2>
          <p className="text-[16px] leading-6 text-text-muted">Ketuk satu kalimat. Layar penuh, huruf besar.</p>
          <div className="grid gap-2">
            {PHRASES.map((ph) => (
              <button
                key={ph}
                type="button"
                onClick={() => setShow({ title: ph, lines: [], paint: INK })}
                className="m-press min-h-14 bg-[color:var(--color-bg)] px-4 py-3 text-left text-[18px] leading-6 font-bold"
              >
                {ph}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (own.trim()) setShow({ title: own.trim(), lines: [], paint: INK });
            }}
          >
            <label className="sr-only" htmlFor="own">Tulis kalimat sendiri</label>
            <input id="own" value={own} maxLength={120} onChange={(e) => setOwn(e.target.value)} placeholder="Tulis kalimat sendiri" className="m-field min-w-0 flex-1" />
            <button className="m-btn shrink-0 !px-5" disabled={!own.trim()}>Tampilkan</button>
          </form>
        </section>

        <section className="s-panel m-surface space-y-3" aria-labelledby="kontak-title" style={{ "--i": 3 } as React.CSSProperties}>
          <h2 id="kontak-title" className="s-h2">Kontak darurat</h2>
          <p className="text-[16px] leading-6 text-text-muted">Orang di sekitar bisa menelepon mereka untuk Anda.</p>
          {contacts.length === 0 && (
            <Link href="/kontak" className="m-btn m-btn--line w-full">Tambah kontak darurat</Link>
          )}
          {contacts.map((c) => (
            <div key={c.phone} className="flex items-center gap-2 bg-[color:var(--color-bg)] p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[18px] font-bold">{c.name}</p>
                <p className="font-mono text-[15px] text-text-muted">{c.phone}</p>
              </div>
              <a href={`tel:${c.phone}`} aria-label={`Telepon ${c.name}`} className="m-icon-btn !bg-[color:var(--color-primary)] !text-[color:var(--color-on-primary)]">
                <PhoneIcon size={22} />
              </a>
              <a href={`sms:${c.phone}`} aria-label={`SMS ${c.name}`} className="m-icon-btn">
                <MessageIcon size={22} />
              </a>
            </div>
          ))}
        </section>
      </div>
      {show && <ShowCard title={show.title} lines={show.lines} paint={show.paint} onClose={() => setShow(null)} />}
    </main>
  );
}
