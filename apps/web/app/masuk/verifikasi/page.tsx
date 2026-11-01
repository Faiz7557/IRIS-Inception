"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { PageHead } from "@/components/PageHead";
import { deviceKey } from "@/lib/utils";

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
    <main className="min-h-dvh text-[var(--color-text)]">
      <PageHead title="Masukkan kode" lead={`Kode 6 digit dikirim ke ${phone}.`} back="/masuk" tone="violet" />
      <div className="s-page">
        <div className="s-panel m-surface space-y-4" style={{ "--i": 1 } as React.CSSProperties}>
          {/* Six boxes drawn over one real input: SMS autofill, paste and screen readers keep working. */}
          <div className="relative grid grid-cols-6 gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <span
                key={i}
                aria-hidden
                className={`flex h-16 items-center justify-center font-mono text-[30px] font-bold ${
                  i === code.length && !busy ? "shadow-[inset_0_0_0_4px_var(--color-focus)]" : "shadow-[inset_0_0_0_2px_currentColor]"
                } ${code[i] ? "" : "opacity-60"}`}
              >
                {code[i] ?? ""}
              </span>
            ))}
            <input
              value={code} onChange={(e) => onChange(e.target.value)} onPaste={(e) => { e.preventDefault(); onChange(e.clipboardData.getData("text")); }}
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="Kode 6 digit" disabled={busy} autoFocus
              className="absolute inset-0 h-full w-full cursor-text opacity-0"
            />
          </div>
          {busy && <p role="status" className="text-text-muted">Memeriksa kode…</p>}
          {err && <p role="alert" className="font-semibold text-[var(--color-sos)]">{err}</p>}
          <button onClick={resend} disabled={wait > 0} className="m-btn m-btn--line w-full">
            {wait > 0 ? `Kirim ulang kode (${wait} dtk)` : "Kirim ulang kode"}
          </button>
        </div>
      </div>
    </main>
  );
}
