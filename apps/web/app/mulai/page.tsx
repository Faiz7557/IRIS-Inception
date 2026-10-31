"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IncidentIcon, CheckIcon } from "@/components/icons";
import { paintOf } from "@/lib/incidents";

// Each step is shown, not told: a small live piece of the screen it teaches, plus one short line.
const STEPS = [
  { t: "Pilih kejadian", d: "Ketuk gambar yang sesuai." },
  { t: "Tahan tombol merah", d: "Tahan 3 detik. Kami menelepon 112 untuk Anda." },
  { t: "Jawab dengan tombol", d: "Pertanyaan operator jadi tombol. Ketuk jawaban Anda." },
];

function Demo({ step }: { step: number }) {
  if (step === 0) {
    const ids = ["kebakaran", "kecelakaan", "sakit", "kejahatan"];
    return (
      <div className="grid grid-cols-2 gap-2.5" aria-hidden>
        {ids.map((id, i) => {
          const p = paintOf(id);
          return (
            <div
              key={id}
              style={{ background: p.bg, color: p.fg }}
              className={`flex h-[92px] flex-col justify-between rounded-[14px] p-3 ${i === 0 ? "shadow-[0_0_0_4px_var(--paint-white)]" : "opacity-45"}`}
            >
              <IncidentIcon id={id} size={28} />
              <span className="text-[17px] font-extrabold">{p.label}</span>
            </div>
          );
        })}
      </div>
    );
  }
  if (step === 1) {
    return (
      <div aria-hidden className="relative flex h-[104px] items-center gap-4 overflow-hidden rounded-[18px] bg-sos px-5 text-white">
        <span className="absolute inset-y-0 left-0 w-2/3 bg-white/18" />
        <span className="relative flex size-[58px] items-center justify-center rounded-full border-[5px] border-white text-[22px] font-extrabold">1</span>
        <span className="relative text-[26px] font-extrabold">Terus tahan…</span>
      </div>
    );
  }
  return (
    <div aria-hidden className="space-y-3 rounded-[14px] bg-asphalt-2 p-4">
      <p className="text-[30px] leading-9 font-extrabold">Korban sadar?</p>
      <div className="flex min-h-16 items-center justify-center gap-2 rounded-[12px] bg-done text-[20px] font-extrabold text-ink">
        Ya <CheckIcon size={22} />
      </div>
      <div className="flex min-h-16 items-center justify-center rounded-[12px] bg-paint text-[20px] font-extrabold text-ink opacity-35">Tidak</div>
    </div>
  );
}

export default function Mulai() {
  const r = useRouter();
  const [i, setI] = useState(0);
  const done = () => {
    try { localStorage.setItem("j112.seen_intro", "1"); } catch { /* ignore */ }
    r.replace("/masuk");
  };
  const last = i === STEPS.length - 1;
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-5 pt-4 pb-6">
      <div className="flex min-h-12 items-center justify-between">
        <ol className="flex gap-1.5" aria-label={`Langkah ${i + 1} dari ${STEPS.length}`}>
          {STEPS.map((_, n) => (
            <li key={n} className={`h-1.5 w-10 rounded-full ${n <= i ? "bg-paint" : "bg-asphalt-3"}`} />
          ))}
        </ol>
        <Button variant="ghost" onClick={done}>Lewati</Button>
      </div>

      <section aria-live="polite" className="mt-10 flex flex-1 flex-col gap-8">
        <Demo step={i} />
        <div>
          <h1 className="text-[34px] leading-[38px] font-extrabold tracking-[-0.02em]">{STEPS[i].t}</h1>
          <p className="mt-3 text-[20px] leading-7 text-paint-muted">{STEPS[i].d}</p>
        </div>
      </section>

      <Button size="xl" className="w-full" onClick={() => (last ? done() : setI(i + 1))}>
        {last ? "Mulai" : "Lanjut"}
      </Button>
    </main>
  );
}
