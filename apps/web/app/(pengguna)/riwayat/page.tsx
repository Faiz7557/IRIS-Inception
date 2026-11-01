"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { INCIDENTS } from "@/lib/incidents";
import { PageHead } from "@/components/PageHead";

interface CallRow {
  id: string;
  incident?: string;
  mode?: string;
  state?: string;
  created_at?: string;
  started_at?: string;
  sos_confirmed_at?: string;
}

export default function Riwayat() {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<CallRow[] | { calls?: CallRow[]; items?: CallRow[] }>("/v1/calls")
      .then((d) => setRows(Array.isArray(d) ? d : (d.calls ?? d.items ?? [])))
      .catch(() => setErr("Gagal memuat riwayat."));
  }, []);
  return (
    <main className="text-[var(--color-text)]">
      <PageHead title="Riwayat" back="/pengaturan" tone="taupe" />
      <div className="s-page">
      {err && (
        <p role="alert" className="s-panel m-surface font-semibold text-[var(--color-sos)]">
          {err}
        </p>
      )}
      {rows?.length === 0 && <p className="s-panel m-surface text-[var(--color-text-muted)]">Belum ada panggilan.</p>}
      {rows?.map((c, n) => {
        const when = c.created_at ?? c.started_at ?? c.sos_confirmed_at;
        return (
          <article key={c.id} className="s-panel m-surface" style={{ "--i": Math.min(n + 1, 8) } as React.CSSProperties}>
            <p className="s-display text-[24px] leading-7 font-extrabold tracking-[-0.02em]">
              {INCIDENTS.find((i) => i.id === c.incident)?.label ?? "Umum"}
              {c.mode === "latihan" ? " (latihan)" : ""}
            </p>
            <p className="text-[var(--color-text-muted)]">
              {when ? new Date(when).toLocaleString("id-ID") : ""} {c.state ? `· ${c.state}` : ""}
            </p>
          </article>
        );
      })}
      </div>
    </main>
  );
}
