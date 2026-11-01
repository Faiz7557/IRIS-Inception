"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { clearLocal, loadLocal } from "@/lib/offline-store";
import { supabase } from "@/lib/supabase";
import { PageHead } from "@/components/PageHead";
import { getTheme, setLargeText, setTheme, type Theme } from "@/lib/theme";
import { ChevronIcon, HistoryIcon, IdCardIcon, SchoolIcon, UserIcon, UsersIcon } from "@/components/icons";

type Flag = "practice_mode" | "silent_mode" | "large_text" | "double_tap_sos";
const SWITCHES: Record<"call" | "view", [Flag, string, string][]> = {
  call: [
    ["practice_mode", "Mode latihan", "Tidak menelepon 112 sungguhan."],
    ["double_tap_sos", "Ketuk dua kali untuk SOS", "Selain tahan 3 detik, ketuk 2× cepat juga memanggil."],
  ],
  view: [
    ["large_text", "Teks besar", "Semua tulisan dan tombol diperbesar."],
    ["silent_mode", "Mode senyap", "Layar redup, tanpa getar. Untuk saat harus diam."],
  ],
};
// Device-level flags still work when the profile cannot be loaded.
const LOCAL: Flag[] = ["large_text", "silent_mode"];

function Row({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <Link href={href} className="m-row">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[19px] leading-6 font-bold">{title}</span>
        {sub && <span className="m-row__sub">{sub}</span>}
      </span>
      <ChevronIcon size={22} />
    </Link>
  );
}

export default function Pengaturan() {
  const r = useRouter();
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [flags, setFlags] = useState<Partial<Record<Flag, boolean>>>({});
  const [contacts, setContacts] = useState<number | null>(null);
  const [theme, setThemeState] = useState<Theme>("light");
  const [step, setStep] = useState(0);
  const [word, setWord] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    setThemeState(getTheme());
    const html = document.documentElement.classList;
    setFlags({ practice_mode: true, large_text: html.contains("large-text"), silent_mode: html.contains("silent") });
    api<{ profile: Record<string, unknown> }>("/v1/me/profile")
      .then((d) => {
        setProfile(d.profile);
        setFlags({
          practice_mode: d.profile.practice_mode !== false,
          double_tap_sos: !!d.profile.double_tap_sos,
          large_text: !!d.profile.large_text,
          silent_mode: !!d.profile.silent_mode,
        });
      })
      .catch(() => setErr("Server belum bisa dihubungi. Pengaturan tampilan tetap tersimpan di ponsel ini."));
    api<unknown[] | { contacts: unknown[] }>("/v1/me/contacts")
      .then((d) => setContacts((Array.isArray(d) ? d : d.contacts).length))
      .catch(() => loadLocal().then((l) => setContacts(l.contacts.length)));
  }, []);

  const chooseTheme = (v: Theme) => {
    setTheme(v);
    setThemeState(v);
  };

  async function toggle(k: Flag) {
    const on = !flags[k];
    setFlags((f) => ({ ...f, [k]: on }));
    if (k === "large_text") setLargeText(on);
    if (k === "silent_mode") document.documentElement.classList.toggle("silent", on);
    if (!profile) return; // device-only change
    const next = { ...profile, [k]: on };
    setProfile(next);
    try {
      await api("/v1/me/profile", { method: "PUT", body: JSON.stringify(next) });
    } catch {
      setErr("Gagal menyimpan ke server. Coba lagi.");
    }
  }

  async function signOut() {
    await supabase.auth.signOut().catch(() => {});
    r.replace("/masuk");
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

  const name = typeof profile?.display_name === "string" ? profile.display_name : "";
  const switches = (group: "call" | "view") =>
    SWITCHES[group].map(([k, label, sub]) => (
      <label key={k} className="m-row cursor-pointer">
        <span className="min-w-0 flex-1">
          <span className="block text-[19px] leading-6 font-bold">{label}</span>
          <span className="m-row__sub">{sub}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="m-switch"
          checked={!!flags[k]}
          disabled={!profile && !LOCAL.includes(k)}
          onChange={() => toggle(k)}
        />
      </label>
    ));

  return (
    <main className="text-[var(--color-text)]">
      <PageHead title="Menu" back="/" tone="mustard" />
      <div className="s-page">
        {err && (
          <p role="status" className="s-panel tone-mustard font-semibold">
            {err}
          </p>
        )}

        <section aria-labelledby="data" className="grid gap-1">
          <h2 id="data" className="m-label px-2 pt-2">Data darurat</h2>
          <Row href="/profil" icon={<UserIcon size={26} />} title="Profil darurat" sub={name ? `${name} · dibacakan ke operator` : "Nama, alamat, kondisi medis"} />
          <Row href="/kontak" icon={<UsersIcon size={26} />} title="Kontak darurat" sub={contacts === null ? "Dikabari saat panggilan gagal" : `${contacts} dari 3 kontak`} />
          <Row href="/kartu" icon={<IdCardIcon size={26} />} title="Kartu darurat" sub="Tunjukkan ke petugas, papan tulis" />
          <Row href="/riwayat" icon={<HistoryIcon size={26} />} title="Riwayat panggilan" />
        </section>

        <section aria-labelledby="call" className="grid gap-1">
          <h2 id="call" className="m-label px-2 pt-4">Panggilan</h2>
          {switches("call")}
        </section>

        <section aria-labelledby="view" className="grid gap-1">
          <h2 id="view" className="m-label px-2 pt-4">Tampilan</h2>
          <div role="radiogroup" aria-labelledby="view" className="m-row grid grid-cols-2 gap-2">
            {(["light", "dark"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={theme === v}
                onClick={() => chooseTheme(v)}
                className={`m-btn m-btn--sm ${theme === v ? "" : "m-btn--line"}`}
              >
                {v === "light" ? "Terang" : "Gelap"}
              </button>
            ))}
          </div>
          {switches("view")}
        </section>

        <section aria-labelledby="help" className="grid gap-1">
          <h2 id="help" className="m-label px-2 pt-4">Bantuan</h2>
          <Row href="/latihan" icon={<SchoolIcon size={26} />} title="Coba latihan" sub="Jawab kartu contoh, tanpa menelepon" />
        </section>

        <button type="button" onClick={signOut} className="m-btn m-btn--line mt-4 w-full">Keluar</button>

        {step === 0 && (
          <button onClick={() => setStep(1)} className="min-h-12 w-full font-bold text-[color:var(--color-sos)] underline underline-offset-4">
            Hapus akun dan semua data
          </button>
        )}
        {step === 1 && (
          <section className="s-panel m-surface space-y-3 shadow-[inset_0_0_0_2px_var(--color-sos)]">
            <p>Yang dihapus: profil, kontak, riwayat panggilan, dan catatan persetujuan. Ini tidak bisa dibatalkan.</p>
            <button onClick={() => setStep(2)} className="m-btn m-btn--sos w-full">Lanjut</button>
            <button onClick={() => setStep(0)} className="min-h-12 w-full font-bold">Batal</button>
          </section>
        )}
        {step === 2 && (
          <section className="s-panel m-surface space-y-3 shadow-[inset_0_0_0_2px_var(--color-sos)]">
            <label className="block">
              Ketik <b>HAPUS</b> untuk mengonfirmasi
              <input value={word} onChange={(e) => setWord(e.target.value)} className="m-field mt-2" autoCapitalize="characters" />
            </label>
            <button onClick={remove} disabled={word !== "HAPUS"} className="m-btn m-btn--sos w-full">Hapus permanen</button>
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
