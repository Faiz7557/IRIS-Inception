"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { COPY } from "@/lib/copy";
import { saveLocalProfile } from "@/lib/offline-store";

const VERSION = "medis-v1-2026-10-31";
const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const input =
  "mt-1 min-h-12 w-full rounded-xl border-2 border-[var(--color-text-muted)] bg-[var(--color-surface)] px-4 text-lg disabled:opacity-50";

interface ProfileRes {
  profile: { display_name?: string; address?: string; landmark?: string; blood_type?: string; medical_notes?: string };
  medical_consent?: { granted: boolean };
  opener_preview?: string;
}

export default function Profil() {
  const r = useRouter();
  const [f, setF] = useState({ display_name: "", address: "", landmark: "", blood_type: "", medical_notes: "" });
  const [consent, setConsent] = useState(false);
  const [hadConsent, setHadConsent] = useState(false);
  const [preview, setPreview] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api<ProfileRes>("/v1/me/profile")
      .then((d) => {
        const p = d.profile;
        setF({
          display_name: p.display_name ?? "",
          address: p.address ?? "",
          landmark: p.landmark ?? "",
          blood_type: p.blood_type ?? "",
          medical_notes: p.medical_notes ?? "",
        });
        setConsent(!!d.medical_consent?.granted);
        setHadConsent(!!d.medical_consent?.granted);
        setPreview(d.opener_preview ?? "");
      })
      .catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.display_name.trim()) return setErr("Nama panggilan wajib diisi.");
    setBusy(true);
    setErr("");
    try {
      if (consent !== hadConsent) {
        await api("/v1/me/consents", {
          method: "POST",
          body: JSON.stringify({ kind: "data_medis", version: VERSION, granted: consent }),
        });
        setHadConsent(consent);
      }
      const body = { ...f, ...(consent ? {} : { blood_type: "", medical_notes: "" }), segment: "A" };
      const d = await api<ProfileRes>("/v1/me/profile", { method: "PUT", body: JSON.stringify(body) });
      setPreview(d.opener_preview ?? "");
      await saveLocalProfile({ display_name: f.display_name, address: f.address, landmark: f.landmark }).catch(() => {});
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "Gagal menyimpan. Coba lagi.");
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-6 pb-24 text-[var(--color-text)]">
      <h1 className="text-3xl font-bold">Profil darurat</h1>
      <form onSubmit={save} className="space-y-4">
        <label className="block">
          <span className="font-bold">Nama panggilan</span>
          <input className={input} value={f.display_name} onChange={set("display_name")} autoComplete="nickname" />
        </label>
        <label className="block">
          <span className="font-bold">Alamat</span>
          <input className={input} value={f.address} onChange={set("address")} autoComplete="street-address" />
        </label>
        <label className="block">
          <span className="font-bold">Patokan</span>
          <input className={input} value={f.landmark} onChange={set("landmark")} />
        </label>
        <label className="flex min-h-12 items-start gap-3">
          <input type="checkbox" className="mt-1 size-6" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{COPY["consent.medical"]}</span>
        </label>
        <label className="block">
          <span className="font-bold">Golongan darah</span>
          <select className={input} value={f.blood_type} onChange={set("blood_type")} disabled={!consent}>
            {BLOOD.map((b) => (
              <option key={b} value={b}>
                {b || "Tidak diisi"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-bold">Kondisi medis</span>
          <textarea className={input} rows={3} value={f.medical_notes} onChange={set("medical_notes")} disabled={!consent} />
        </label>
        <p role="alert" className="text-[var(--color-sos)]">
          {err}
        </p>
        <button
          disabled={busy}
          className="min-h-14 w-full rounded-xl bg-[var(--color-primary)] text-lg font-bold text-white disabled:opacity-60"
        >
          {busy ? "Menyimpan…" : "Simpan"}
        </button>
      </form>
      {preview && (
        <section className="rounded-xl bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
          <h2 className="font-bold">Yang akan didengar operator</h2>
          <p className="mt-2">{preview}</p>
          <button
            onClick={() => r.push("/kontak")}
            className="mt-4 min-h-12 w-full rounded-xl border-2 border-[var(--color-primary)] font-bold text-[var(--color-accent)]"
          >
            Lanjut ke kontak darurat
          </button>
        </section>
      )}
    </main>
  );
}
