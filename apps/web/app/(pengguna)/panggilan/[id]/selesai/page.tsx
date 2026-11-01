"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { loadProfile } from "@/lib/geo";
import { paintOf } from "@/lib/incidents";
import type { EndedData } from "@/lib/protocol";
import { PageHead } from "@/components/PageHead";
import { CheckIcon, IncidentIcon, ShareIcon } from "@/components/icons";

interface Summary extends Partial<EndedData> {
  answered?: number;
  practice?: boolean;
  incident?: string;
  dispatched?: boolean;
  log?: { q: string; a: string }[];
}

const REASON: Record<string, string> = {
  operator_hangup: "Operator menutup panggilan",
  user_cancel: "Panggilan dibatalkan",
  fallback_exhausted: "Panggilan tidak tersambung",
  user_link_lost: "Sambungan Anda terputus",
  error: "Panggilan berakhir karena gangguan",
};

const mmss = (d: number) => `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`;

export default function SelesaiPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Summary>({});
  const [offer, setOffer] = useState<"ask" | "done" | null>(null);
  const [shared, setShared] = useState(false);

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
    if (p && !p.local) await api("/v1/me/profile", { method: "PUT", body: JSON.stringify({ ...p, practice_mode: false }) }).catch(() => {});
    setOffer("done");
  }

  const d = s.duration_s ?? 0;
  const paint = paintOf(s.incident);
  const log = s.log ?? [];

  // Plain text a family member can read in any messenger.
  async function share() {
    const text = [
      `Ringkasan panggilan darurat (Jembatan 112)${s.practice ? " - latihan" : ""}`,
      `Kejadian: ${paint.label}`,
      `Hasil: ${s.dispatched ? "petugas dikirim" : (REASON[s.reason ?? ""] ?? "selesai").toLowerCase()}`,
      `Durasi: ${mmss(d)}`,
      ...log.map((x) => `- ${x.q} ${x.a}`),
    ].join("\n");
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setShared(true);
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  return (
    <main className="min-h-dvh">
      <PageHead title={s.dispatched ? "Bantuan dikirim" : "Panggilan selesai"} lead={REASON[s.reason ?? ""] ?? ""} tone={s.dispatched ? "sage" : "taupe"} />
      <div className="s-page">
        <div className="s-panel flex items-center gap-4 !py-4" style={{ background: paint.bg, color: paint.fg, "--i": 1 } as React.CSSProperties}>
          <IncidentIcon id={s.incident ?? "umum"} size={32} />
          <span className="s-display flex-1 text-[24px] leading-7 font-black tracking-[-0.02em]">{paint.label}</span>
          {s.practice && <span className="m-chip">Latihan</span>}
        </div>

        <dl className="grid grid-cols-2 gap-2">
          <div className="s-panel m-surface" style={{ "--i": 2 } as React.CSSProperties}>
            <dt className="m-label">Durasi</dt>
            <dd className="s-display font-mono text-[34px] leading-none font-black tracking-[-0.03em]">{mmss(d)}</dd>
          </div>
          <div className="s-panel m-surface" style={{ "--i": 3 } as React.CSSProperties}>
            <dt className="m-label">Terjawab</dt>
            <dd className="s-display text-[34px] leading-none font-black tracking-[-0.03em]">{s.answered ?? 0}</dd>
          </div>
        </dl>

        {log.length > 0 && (
          <section className="s-panel m-surface" aria-labelledby="log-title">
            <h2 id="log-title" className="m-label">Jawaban yang didengar operator</h2>
            <ol className="mt-2 space-y-3">
              {log.map((x, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-[color:var(--color-success)]"><CheckIcon size={22} /></span>
                  <span className="min-w-0">
                    <span className="block text-[16px] leading-6 text-text-muted">{x.q}</span>
                    <span className="block text-[19px] leading-7 font-bold">{x.a}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {offer === "ask" && (
          <div className="s-panel tone-mustard space-y-3">
            <p className="s-h2">Matikan mode latihan?</p>
            <p className="text-[16px] leading-6">Panggilan berikutnya akan tersambung ke konsol operator simulasi.</p>
            <div className="flex gap-2">
              <button type="button" onClick={turnOffPractice} className="m-btn flex-1">Ya</button>
              <button type="button" onClick={() => setOffer(null)} className="m-btn m-btn--line flex-1">Nanti</button>
            </div>
          </div>
        )}
        {offer === "done" && <p role="status" className="s-panel m-surface font-semibold">Mode latihan dimatikan.</p>}

        <Link href="/" className="m-btn w-full">Kembali ke beranda</Link>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={share} className="m-btn m-btn--line">
            <ShareIcon size={20} />
            {shared ? "Disalin" : "Bagikan"}
          </button>
          <Link href="/riwayat" className="m-btn m-btn--line">Riwayat</Link>
        </div>
      </div>
    </main>
  );
}
