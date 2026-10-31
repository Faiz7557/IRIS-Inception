"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { loadProfile } from "@/lib/geo";
import type { EndedData } from "@/lib/protocol";

interface Summary extends Partial<EndedData> { answered?: number; practice?: boolean }

const REASON: Record<string, string> = {
  operator_hangup: "Operator menutup panggilan",
  user_cancel: "Panggilan dibatalkan",
  fallback_exhausted: "Panggilan tidak tersambung",
  user_link_lost: "Sambungan Anda terputus",
  error: "Panggilan berakhir karena gangguan",
};

export default function SelesaiPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Summary>({});
  const [offer, setOffer] = useState<"ask" | "done" | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`j112.end.${id}`);
      if (raw) {
        const v = JSON.parse(raw) as Summary;
        setS(v);
        if (v.practice) setOffer("ask");
      }
    } catch {
      /* show the page without numbers */
    }
  }, [id]);

  async function turnOffPractice() {
    const p = await loadProfile();
    if (p) await api("/v1/me/profile", { method: "PUT", body: JSON.stringify({ ...p, practice_mode: false }) }).catch(() => {});
    setOffer("done");
  }

  const d = s.duration_s ?? 0;
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] space-y-4 px-4 py-6">
      <h1 className="text-[34px] leading-[38px] font-extrabold tracking-[-0.02em]">Panggilan selesai</h1>
      <p className="text-[18px]">{REASON[s.reason ?? ""] ?? ""}</p>
      <dl className="space-y-2 rounded-[16px] bg-[color:var(--color-surface)] p-4">
        <div className="flex justify-between"><dt>Durasi</dt><dd className="font-bold">{Math.floor(d / 60)} mnt {d % 60} dtk</dd></div>
        <div className="flex justify-between"><dt>Pertanyaan terjawab</dt><dd className="font-bold">{s.answered ?? 0}</dd></div>
      </dl>
      {offer === "ask" && (
        <div className="space-y-2 rounded-[16px] bg-[color:var(--color-warning-bg)] p-4">
          <p className="font-bold">Matikan mode latihan?</p>
          <div className="flex gap-3">
            <button type="button" onClick={turnOffPractice} className="min-h-[56px] flex-1 rounded-[12px] bg-[color:var(--color-primary)] font-extrabold text-ink">Ya</button>
            <button type="button" onClick={() => setOffer(null)} className="min-h-[56px] flex-1 rounded-[12px] border-[3px] border-paint/60 font-bold text-paint">Nanti</button>
          </div>
        </div>
      )}
      {offer === "done" && <p role="status">Mode latihan dimatikan.</p>}
      <Link href="/" className="flex min-h-[56px] items-center justify-center rounded-[12px] bg-[color:var(--color-primary)] font-extrabold text-ink">
        Kembali ke beranda
      </Link>
    </main>
  );
}
