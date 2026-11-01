"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { loadProfile } from "@/lib/geo";
import type { EndedData } from "@/lib/protocol";
import { PageHead } from "@/components/PageHead";

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
    <main className="min-h-dvh">
      <PageHead title="Panggilan selesai" lead={REASON[s.reason ?? ""] ?? ""} tone="sage" />
      <div className="s-page">
      <dl className="grid grid-cols-2 gap-2">
        <div className="s-panel m-surface" style={{ "--i": 1 } as React.CSSProperties}>
          <dt className="m-label">Durasi</dt>
          <dd className="s-display text-[34px] leading-none font-black tracking-[-0.03em]">{Math.floor(d / 60)}:{String(d % 60).padStart(2, "0")}</dd>
        </div>
        <div className="s-panel m-surface" style={{ "--i": 2 } as React.CSSProperties}>
          <dt className="m-label">Terjawab</dt>
          <dd className="s-display text-[34px] leading-none font-black tracking-[-0.03em]">{s.answered ?? 0}</dd>
        </div>
      </dl>
      {offer === "ask" && (
        <div className="s-panel tone-mustard space-y-3" style={{ "--i": 3 } as React.CSSProperties}>
          <p className="s-h2">Matikan mode latihan?</p>
          <div className="flex gap-2">
            <button type="button" onClick={turnOffPractice} className="m-btn flex-1">Ya</button>
            <button type="button" onClick={() => setOffer(null)} className="m-btn m-btn--line flex-1">Nanti</button>
          </div>
        </div>
      )}
      {offer === "done" && <p role="status" className="s-panel m-surface font-semibold">Mode latihan dimatikan.</p>}
      <Link href="/" className="m-btn w-full">
        Kembali ke beranda
      </Link>
      </div>
    </main>
  );
}
