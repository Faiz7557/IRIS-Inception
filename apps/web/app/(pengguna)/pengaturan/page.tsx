"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { clearLocal } from "@/lib/offline-store";
import { supabase } from "@/lib/supabase";
import { PageHead } from "@/components/PageHead";
import { getTheme, setTheme, type Theme } from "@/lib/theme";

type Flag = "practice_mode" | "silent_mode" | "large_text" | "double_tap_sos";
const LABELS: [Flag, string][] = [
  ["practice_mode", "Mode latihan"],
  ["silent_mode", "Mode senyap"],
  ["large_text", "Teks besar"],
  ["double_tap_sos", "Ketuk dua kali untuk SOS"],
];
const link = "s-panel tone-ink s-display flex items-center justify-between !py-4 text-[24px] font-extrabold tracking-[-0.02em] no-underline";

export default function Pengaturan() {
  const r = useRouter();
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => setThemeState(getTheme()), []);
  const chooseTheme = (v: Theme) => {
    setTheme(v);
    setThemeState(v);
  };
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
    <main className="text-[var(--color-text)]">
      <PageHead title="Pengaturan" back="/" tone="mustard" />
      <div className="s-page">
      <section className="s-panel m-surface" style={{ "--i": 1 } as React.CSSProperties}>
        <h2 id="tampilan" className="m-label">Tampilan</h2>
        <div role="radiogroup" aria-labelledby="tampilan" className="grid grid-cols-2 gap-2">
          {(["light", "dark"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={theme === v}
              onClick={() => chooseTheme(v)}
              className={`m-btn ${theme === v ? "" : "m-btn--line"}`}
            >
              {v === "light" ? "Terang" : "Gelap"}
            </button>
          ))}
        </div>
        {!!profile?.silent_mode && <p className="mt-3 text-[16px] leading-6 text-[var(--color-text-muted)]">Mode senyap selalu memakai tampilan gelap.</p>}
      </section>
      {LABELS.map(([k, label], n) => (
        <label key={k} className="s-panel m-surface flex items-center justify-between gap-4 !py-4" style={{ "--i": n + 2 } as React.CSSProperties}>
          <span className="text-lg font-semibold">{label}</span>
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
        <Link href="/profil" className={link}>Profil darurat <span aria-hidden>→</span></Link>
        <Link href="/kontak" className={link}>Kontak darurat <span aria-hidden>→</span></Link>
        <Link href="/riwayat" className={link}>Riwayat panggilan <span aria-hidden>→</span></Link>
      </nav>
      {err && (
        <p role="alert" className="s-panel m-surface font-semibold text-[var(--color-sos)]">
          {err}
        </p>
      )}
      {step === 0 && (
        <button onClick={() => setStep(1)} className="m-btn m-btn--danger w-full">
          Hapus akun dan semua data
        </button>
      )}
      {step === 1 && (
        <section className="s-panel m-surface space-y-3 shadow-[inset_0_0_0_2px_var(--color-sos)]">
          <p>Yang dihapus: profil, kontak, riwayat panggilan, dan catatan persetujuan. Ini tidak bisa dibatalkan.</p>
          <button onClick={() => setStep(2)} className="m-btn m-btn--sos w-full">
            Lanjut
          </button>
          <button onClick={() => setStep(0)} className="min-h-12 w-full font-bold">Batal</button>
        </section>
      )}
      {step === 2 && (
        <section className="s-panel m-surface space-y-3 shadow-[inset_0_0_0_2px_var(--color-sos)]">
          <label className="block">
            Ketik <b>HAPUS</b> untuk mengonfirmasi
            <input value={word} onChange={(e) => setWord(e.target.value)} className="m-field" />
          </label>
          <button onClick={remove} disabled={word !== "HAPUS"} className="m-btn m-btn--sos w-full">
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
      </div>
    </main>
  );
}
