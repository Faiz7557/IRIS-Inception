"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { paintOf } from "@/lib/incidents";
import { PageHead } from "@/components/PageHead";
import { IncidentIcon } from "@/components/icons";

interface CallRow {
  id: string;
  incident?: string;
  mode?: string;
  state?: string;
  sos_confirmed_at?: string | null;
  answered_at?: string | null;
  dispatched_at?: string | null;
  ended_at?: string | null;
  end_reason?: string | null;
}

// Outcome in the user's words, never the server's state names.
function outcome(c: CallRow): { text: string; ok: boolean } {
  if (c.dispatched_at) return { text: "Petugas dikirim", ok: true };
  if (!c.ended_at) return { text: "Masih berjalan", ok: true };
  const r: Record<string, string> = {
    operator_hangup: "Operator menutup panggilan",
    user_cancel: "Dibatalkan",
    fallback_exhausted: "Tidak tersambung",
    user_link_lost: "Sambungan terputus",
  };
  return { text: r[c.end_reason ?? ""] ?? (c.answered_at ? "Selesai" : "Tidak tersambung"), ok: false };
}

function duration(c: CallRow): string | null {
  if (!c.answered_at || !c.ended_at) return null;
  const s = Math.max(0, Math.round((Date.parse(c.ended_at) - Date.parse(c.answered_at)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function day(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hari ini";
  if (d.toDateString() === y.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function Riwayat() {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<CallRow[] | { calls?: CallRow[]; items?: CallRow[] }>("/v1/calls")
      .then((d) => setRows(Array.isArray(d) ? d : (d.calls ?? d.items ?? [])))
      .catch(() => setErr("Riwayat belum bisa dimuat. Periksa internet lalu coba lagi."));
  }, []);

  let lastDay = "";
  return (
    <main className="text-[var(--color-text)]">
      <PageHead title="Riwayat" lead="50 panggilan terakhir dari akun ini." back="/pengaturan" tone="taupe" />
      <div className="s-page">
        {err && (
          <p role="alert" className="s-panel m-surface font-semibold text-[color:var(--color-sos)]">
            {err}
          </p>
        )}
        {rows === null && !err && <p className="s-panel m-surface text-text-muted" aria-busy="true">Memuat…</p>}
        {rows?.length === 0 && (
          <div className="s-panel m-surface space-y-4">
            <p className="text-[18px] leading-7">Belum ada panggilan. Semoga tetap begitu.</p>
            <Link href="/latihan" className="m-btn m-btn--line w-full">Coba latihan dulu</Link>
          </div>
        )}
        {rows?.map((c, n) => {
          const when = c.sos_confirmed_at;
          const head = when ? day(when) : "";
          const showHead = head !== lastDay;
          lastDay = head;
          const p = paintOf(c.incident);
          const o = outcome(c);
          const dur = duration(c);
          return (
            <div key={c.id} className="grid gap-2">
              {showHead && head && <h2 className="m-label px-2 pt-3">{head}</h2>}
              <article className="s-panel m-surface flex items-center gap-4 !py-4" style={{ "--i": Math.min(n + 1, 6) } as React.CSSProperties}>
                <span className="flex size-14 shrink-0 items-center justify-center" style={{ background: p.bg, color: p.fg }}>
                  <IncidentIcon id={c.incident ?? "umum"} size={28} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="s-display text-[22px] leading-7 font-extrabold tracking-[-0.02em]">{p.label}</span>
                    {c.mode === "latihan" && <span className="m-chip !min-h-6 !px-1.5 !text-[12px]">Latihan</span>}
                  </p>
                  <p className={`text-[16px] leading-6 font-semibold ${o.ok ? "text-[color:var(--color-success)]" : ""}`}>{o.text}</p>
                  <p className="text-[15px] leading-5 text-text-muted">
                    {when ? new Date(when).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : ""}
                    {dur ? ` · ${dur}` : ""}
                  </p>
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </main>
  );
}
