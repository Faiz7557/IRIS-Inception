"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHead } from "@/components/PageHead";

function normalizePhone(raw: string): string {
  const s = raw.replace(/[\s-]/g, "");
  if (s.startsWith("08")) return "+62" + s.slice(1);
  if (s.startsWith("62")) return "+" + s;
  return s;
}

export default function Masuk() {
  const r = useRouter();
  const [v, setV] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const phone = normalizePhone(v);
    if (!/^\+62[0-9]{8,13}$/.test(phone)) return setErr("Nomor tidak valid. Contoh: 0812 3456 7890");
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) return setErr("Kode belum bisa dikirim. Coba lagi sebentar lagi.");
    try { sessionStorage.setItem("j112_phone", phone); } catch { /* ignore */ }
    r.push("/masuk/verifikasi");
  }

  return (
    <main className="min-h-dvh text-[var(--color-text)]">
      <PageHead title="Masuk" lead="Kami kirim kode 6 digit lewat SMS." tone="violet" />
      <form onSubmit={submit} className="s-page">
        <div className="s-panel m-surface space-y-4" style={{ "--i": 1 } as React.CSSProperties}>
          <label className="block">
            <span className="m-label">Nomor ponsel</span>
            <input
              type="tel" inputMode="tel" autoComplete="tel-national" value={v} onChange={(e) => setV(e.target.value)}
              placeholder="0812 3456 7890" aria-describedby="e"
              className="m-field"
            />
          </label>
          {err && <p id="e" role="alert" className="font-semibold text-[var(--color-sos)]">{err}</p>}
          <button disabled={busy} className="m-btn w-full">
            {busy ? "Mengirim…" : "Kirim kode"}
          </button>
        </div>
      </form>
    </main>
  );
}
