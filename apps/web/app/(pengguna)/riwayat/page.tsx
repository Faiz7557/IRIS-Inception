"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { INCIDENTS } from "@/lib/incidents";

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
    <main className="mx-auto max-w-md space-y-3 p-6 pb-24 text-[var(--color-text)]">
      <h1 className="text-3xl font-bold">Riwayat</h1>
      <p role="alert" className="text-[var(--color-sos)]">
        {err}
      </p>
      {rows?.length === 0 && <p className="text-[var(--color-text-muted)]">Belum ada panggilan.</p>}
      {rows?.map((c) => {
        const when = c.created_at ?? c.started_at ?? c.sos_confirmed_at;
        return (
          <article key={c.id} className="rounded-xl bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
            <p className="text-lg font-bold">
              {INCIDENTS.find((i) => i.id === c.incident)?.label ?? "Umum"}
              {c.mode === "latihan" ? " (latihan)" : ""}
            </p>
            <p className="text-[var(--color-text-muted)]">
              {when ? new Date(when).toLocaleString("id-ID") : ""} {c.state ? `· ${c.state}` : ""}
            </p>
          </article>
        );
      })}
    </main>
  );
}
