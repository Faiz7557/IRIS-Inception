"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { clearLocal } from "@/lib/offline-store";
import { supabase } from "@/lib/supabase";

type Flag = "practice_mode" | "silent_mode" | "large_text" | "double_tap_sos";
const LABELS: [Flag, string][] = [
  ["practice_mode", "Mode latihan"],
  ["silent_mode", "Mode senyap"],
  ["large_text", "Teks besar"],
  ["double_tap_sos", "Ketuk dua kali untuk SOS"],
];
const link = "flex min-h-12 items-center rounded-xl bg-[var(--color-surface)] px-4 font-bold";

export default function Pengaturan() {
  const r = useRouter();
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [step, setStep] = useState(0);
  const [word, setWord] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api<{ profile: Record<string, unknown> }>("/v1/me/profile")
      .then((d) => setProfile(d.profile))
      .catch(() => setErr("Profil belum ada. Isi profil dulu."));
  }, []);

  async function toggle(k: Flag) {
    if (!profile) return;
    const next = { ...profile, [k]: !profile[k] };
    setProfile(next);
    try {
      await api("/v1/me/profile", { method: "PUT", body: JSON.stringify(next) });
    } catch {
      setProfile(profile);
      setErr("Gagal menyimpan pengaturan.");
    }
  }

  async function remove() {
    try {
      await api("/v1/me", { method: "DELETE" });
    } catch (x) {
      return setErr(
        x instanceof ApiError && x.status === 409 ? "Ada panggilan aktif. Tunggu sampai selesai." : "Gagal menghapus akun.",
      );
    }
    await clearLocal();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut().catch(() => {});
    r.replace("/mulai");
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-6 pb-24 text-[var(--color-text)]">
      <h1 className="text-[34px] leading-[38px] font-extrabold tracking-[-0.02em]">Pengaturan</h1>
      {LABELS.map(([k, label]) => (
        <label key={k} className="flex min-h-14 items-center justify-between rounded-xl bg-[var(--color-surface)] px-4">
          <span className="text-lg">{label}</span>
          <input
            type="checkbox"
            role="switch"
            className="size-7"
            checked={!!profile?.[k]}
            disabled={!profile}
            onChange={() => toggle(k)}
          />
        </label>
      ))}
      <nav className="grid gap-2">
        <Link href="/profil" className={link}>Profil darurat</Link>
        <Link href="/kontak" className={link}>Kontak darurat</Link>
        <Link href="/riwayat" className={link}>Riwayat panggilan</Link>
      </nav>
      <p role="alert" className="text-[var(--color-sos)]">
        {err}
      </p>
      {step === 0 && (
        <button
          onClick={() => setStep(1)}
          className="min-h-12 w-full rounded-xl border-2 border-[var(--color-sos)] font-bold text-[var(--color-sos)]"
        >
          Hapus akun dan semua data
        </button>
      )}
      {step === 1 && (
        <section className="space-y-3 rounded-xl border-2 border-[var(--color-sos)] p-4">
          <p>Yang dihapus: profil, kontak, riwayat panggilan, dan catatan persetujuan. Ini tidak bisa dibatalkan.</p>
          <button onClick={() => setStep(2)} className="min-h-12 w-full rounded-xl bg-[var(--color-sos)] font-bold text-white">
            Lanjut
          </button>
          <button onClick={() => setStep(0)} className="min-h-12 w-full font-bold">Batal</button>
        </section>
      )}
      {step === 2 && (
        <section className="space-y-3 rounded-xl border-2 border-[var(--color-sos)] p-4">
          <label className="block">
            Ketik <b>HAPUS</b> untuk mengonfirmasi
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              className="mt-1 min-h-12 w-full rounded-xl border-2 bg-[var(--color-surface)] px-4"
            />
          </label>
          <button
            onClick={remove}
            disabled={word !== "HAPUS"}
            className="min-h-12 w-full rounded-xl bg-[var(--color-sos)] font-bold text-white disabled:opacity-50"
          >
            Hapus permanen
          </button>
          <button
            onClick={() => {
              setStep(0);
              setWord("");
            }}
            className="min-h-12 w-full font-bold"
          >
            Batal
          </button>
        </section>
      )}
    </main>
  );
}
