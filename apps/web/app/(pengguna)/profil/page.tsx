"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { COPY } from "@/lib/copy";
import { saveLocalProfile } from "@/lib/offline-store";
import { PageHead } from "@/components/PageHead";

const VERSION = "medis-v1-2026-10-31";
const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const input = "m-field";

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
  const [baru, setBaru] = useState(false); // first run after sign-in: only what the operator needs to find you
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    setBaru(new URLSearchParams(window.location.search).has("baru"));
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
    if (baru && !f.address.trim()) return setErr("Alamat wajib diisi supaya petugas bisa menemukan Anda.");
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
      // Empty fields go as null: the API rejects "" for blood_type (enum) and display_name (min length 1).
      const fields = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
      const body = { ...fields, ...(consent ? {} : { blood_type: null, medical_notes: null }), segment: "A" };
      const d = await api<ProfileRes>("/v1/me/profile", { method: "PUT", body: JSON.stringify(body) });
      setPreview(d.opener_preview ?? "");
      await saveLocalProfile({ display_name: f.display_name, address: f.address, landmark: f.landmark }).catch(() => {});
      if (baru) return void r.replace("/");
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "Gagal menyimpan. Coba lagi.");
    }
    setBusy(false);
  }

  return (
    <main className="text-[var(--color-text)]">
      {baru ? (
        <PageHead title="Di mana Anda tinggal?" lead="Petugas memakai alamat ini kalau GPS tidak ada." tone="sage" />
      ) : (
        <PageHead title="Profil darurat" lead="Dibacakan ke operator saat Anda meminta bantuan." back="/pengaturan" tone="sage" />
      )}
      <div className="s-page">
      <form onSubmit={save} className="s-panel m-surface space-y-5" style={{ "--i": 1 } as React.CSSProperties}>
        <label className="block">
          <span className="m-label">Nama panggilan</span>
          <input className={input} value={f.display_name} onChange={set("display_name")} autoComplete="nickname" />
        </label>
        <label className="block">
          <span className="m-label">Alamat</span>
          <input className={input} value={f.address} onChange={set("address")} autoComplete="street-address" />
        </label>
        <label className="block">
          <span className="m-label">Patokan</span>
          <input className={input} value={f.landmark} onChange={set("landmark")} />
        </label>
        {!baru && (
          <>
            <label className="flex min-h-12 items-start gap-3">
              <input type="checkbox" className="mt-1 size-6" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{COPY["consent.medical"]}</span>
            </label>
            <label className="block">
              <span className="m-label">Golongan darah</span>
              <select className={input} value={f.blood_type} onChange={set("blood_type")} disabled={!consent}>
                {BLOOD.map((b) => (
                  <option key={b} value={b}>
                    {b || "Tidak diisi"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="m-label">Kondisi medis</span>
              <textarea className={input} rows={3} value={f.medical_notes} onChange={set("medical_notes")} disabled={!consent} />
            </label>
          </>
        )}
        {err && (
          <p role="alert" className="font-semibold text-[var(--color-sos)]">
            {err}
          </p>
        )}
        <button disabled={busy} className="m-btn w-full">
          {busy ? "Menyimpan…" : baru ? "Simpan dan mulai" : "Simpan"}
        </button>
      </form>
      {preview && !baru && (
        <section className="s-panel tone-ink" style={{ "--i": 2 } as React.CSSProperties}>
          <h2 className="m-label">Yang akan didengar operator</h2>
          <p className="mt-2 text-[20px] leading-8">{preview}</p>
          <button onClick={() => r.push("/kontak")} className="m-btn m-btn--line mt-6 w-full">
            Lanjut ke kontak darurat
          </button>
        </section>
      )}
      </div>
    </main>
  );
}
