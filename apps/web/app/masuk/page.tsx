"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

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
    <main className="mx-auto min-h-dvh max-w-md p-6 text-[var(--color-text)]">
      <h1 className="text-3xl font-bold">Masuk</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="font-bold">Nomor ponsel</span>
          <input
            type="tel" inputMode="tel" autoComplete="tel-national" value={v} onChange={(e) => setV(e.target.value)}
            placeholder="0812 3456 7890" aria-describedby="e"
            className="mt-1 min-h-14 w-full rounded-xl border-2 border-[var(--color-text-muted)] bg-[var(--color-surface)] px-4 text-lg"
          />
        </label>
        <p id="e" role="alert" className="text-[var(--color-sos)]">{err}</p>
        <button disabled={busy} className="min-h-14 w-full rounded-xl bg-[var(--color-primary)] text-lg font-bold text-white disabled:opacity-60">
          {busy ? "Mengirim…" : "Kirim kode"}
        </button>
      </form>
    </main>
  );
}
