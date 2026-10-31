"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";

function deviceKey(): string {
  let k = localStorage.getItem("j112_device_key");
  if (!k) { k = crypto.randomUUID(); localStorage.setItem("j112_device_key", k); }
  return k;
}

export default function Verifikasi() {
  const r = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(60);

  useEffect(() => {
    const p = sessionStorage.getItem("j112_phone");
    if (!p) r.replace("/masuk"); else setPhone(p);
  }, [r]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify(token: string) {
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
    if (error) { setBusy(false); setCode(""); return setErr("Kode salah. Coba lagi."); }
    try {
      await api("/v1/me/devices", { method: "POST", body: JSON.stringify({ device_key: deviceKey() }) });
    } catch { /* device registration is retried on next login */ }
    sessionStorage.removeItem("j112_phone");
    try {
      // New users get 200 with an empty profile, not 404: without an address the opener says "lokasi belum diketahui".
      const d = await api<{ profile?: { address?: string } }>("/v1/me/profile");
      r.replace(d.profile?.address?.trim() ? "/" : "/profil?baru=1");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) r.replace("/profil?baru=1"); else r.replace("/");
    }
  }

  function onChange(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 6);
    setCode(d);
    if (d.length === 6 && !busy) void verify(d);
  }

  async function resend() {
    setWait(60);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) setErr("Kode belum bisa dikirim ulang.");
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md p-6 text-[var(--color-text)]">
      <h1 className="text-3xl font-bold">Masukkan kode</h1>
      <p className="mt-2 text-[var(--color-text-muted)]">Kode 6 digit dikirim ke {phone}.</p>
      <input
        value={code} onChange={(e) => onChange(e.target.value)} onPaste={(e) => { e.preventDefault(); onChange(e.clipboardData.getData("text")); }}
        inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="Kode 6 digit" disabled={busy}
        className="mt-6 min-h-16 w-full rounded-xl border-2 border-[var(--color-text-muted)] bg-[var(--color-surface)] text-center font-mono text-3xl tracking-[0.5em]"
      />
      <p role="alert" className="mt-3 text-[var(--color-sos)]">{err}</p>
      <button
        onClick={resend} disabled={wait > 0}
        className="mt-4 min-h-12 w-full rounded-xl border-2 border-[var(--color-primary)] font-bold text-[var(--color-accent)] disabled:opacity-50"
      >
        {wait > 0 ? `Kirim ulang kode (${wait} dtk)` : "Kirim ulang kode"}
      </button>
    </main>
  );
}
