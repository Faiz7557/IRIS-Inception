"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { INCIDENTS, paintOf } from "@/lib/incidents";
import { IncidentIcon } from "@/components/icons";

// Screen 1 (brief §7): three steps, skippable, shown once; each step shows a small copy of the real screen.
const STEPS = [
  { t: "Pilih kejadian", d: "Ketuk gambar yang paling cocok. Ragu? Lewati saja.", tone: "tone-orange" },
  { t: "Tahan SOS 3 detik", d: "Sistem menelepon 112 dan membacakan pesan Anda ke operator.", tone: "tone-mustard" },
  { t: "Jawab dengan tombol", d: "Pertanyaan operator jadi satu kalimat pendek. Ketuk jawabannya.", tone: "tone-sage" },
];
const FAQ = [
  ["Bagaimana bila internet putus?", "Aplikasi menyiapkan teks SMS berisi kejadian dan lokasi Anda untuk kontak darurat."],
  ["Siapa yang tahu kondisi medis saya?", "Hanya operator, dan hanya bila Anda setuju di profil."],
  ["Bisa dipakai diam-diam?", "Bisa. Mode senyap membuat layar redup, tanpa getar dan tanpa bunyi."],
];

function Picture({ step }: { step: number }) {
  if (step === 0)
    return (
      <div className="grid grid-cols-3 gap-1.5" aria-hidden>
        {INCIDENTS.map((i, n) => {
          const p = paintOf(i.id);
          return (
            <span key={i.id} style={{ background: p.bg, color: p.fg }} className={`flex h-16 items-end p-2 ${n === 0 ? "shadow-[inset_0_0_0_4px_var(--ink-dark)]" : "opacity-60"}`}>
              <IncidentIcon id={i.id} size={24} />
            </span>
          );
        })}
      </div>
    );
  if (step === 1)
    return (
      <div aria-hidden className="relative flex h-24 items-center overflow-hidden bg-[color:var(--color-sos)] px-4 text-white">
        <span className="s-display text-[26px] font-black tracking-[-0.03em]">Terus tahan…</span>
        <span className="s-display ml-auto text-[48px] leading-none font-black">2</span>
        <span className="absolute inset-x-0 bottom-0 h-2.5 bg-white/25">
          <span className="block h-full w-2/3 bg-white" />
        </span>
      </div>
    );
  return (
    <div aria-hidden className="space-y-1.5 bg-[color:var(--color-surface)] p-3 text-[color:var(--color-text)]">
      <p className="s-display text-[24px] leading-7 font-black tracking-[-0.03em]">Ada orang terjebak?</p>
      <span className="s-display flex h-11 items-center justify-center bg-sill-sage text-[18px] font-black text-ink">Terkirim ✓</span>
      <span className="s-display flex h-11 items-center justify-center bg-[color:var(--color-primary)] text-[18px] font-black text-[color:var(--color-on-primary)] opacity-35">Tidak</span>
    </div>
  );
}

export default function Mulai() {
  const r = useRouter();
  const [step, setStep] = useState(0); // 0..2 steps, 3 = ready
  const go = (href: string) => {
    try {
      localStorage.setItem("j112.seen_intro", "1");
    } catch {
      /* ignore */
    }
    r.replace(href);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setStep((s) => Math.min(3, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const s = STEPS[step];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-2 text-[var(--color-text)]">
      <div className="s-bar">
        <span className="s-word">J112</span>
        {step < 3 && (
          <button type="button" onClick={() => setStep(3)} className="m-btn m-btn--sm m-btn--line">Lewati</button>
        )}
      </div>

      {step < 3 ? (
        <section key={step} aria-labelledby="step-title" aria-live="polite" className="grid gap-2">
          <div className={`s-panel ${s.tone} space-y-5`}>
            <p className="m-label">Langkah {step + 1} dari {STEPS.length}</p>
            <h1 id="step-title" className="s-title">{s.t}</h1>
            <Picture step={step} />
          </div>
          <p className="s-panel m-surface text-[19px] leading-7" style={{ "--i": 1 } as React.CSSProperties}>{s.d}</p>
        </section>
      ) : (
        <section aria-labelledby="ready-title" className="grid gap-2">
          <div className="s-panel tone-ink space-y-4">
            <h1 id="ready-title" className="s-title">Minta tolong tanpa bicara.</h1>
            <p className="text-[18px] leading-7">
              Jembatan 112 menghubungkan teman tuli dan teman yang sulit bicara dengan operator 112.
            </p>
          </div>
          <p className="s-panel tone-mustard text-[16px] leading-6 font-semibold" style={{ "--i": 1 } as React.CSSProperties}>
            Prototipe: belum menelepon 112 sungguhan. Akun baru mulai di mode latihan.
          </p>
          <div className="grid gap-2" style={{ "--i": 2 } as React.CSSProperties}>
            {FAQ.map(([q, a]) => (
              <details key={q} className="m-surface px-[18px] py-1">
                <summary className="min-h-12 cursor-pointer content-center text-[17px] font-bold">{q}</summary>
                <p className="pb-4 text-[16px] leading-6 text-text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <div className="s-dock mt-auto grid gap-2 pt-6">
        {step < 3 ? (
          <>
            <div className="flex justify-center gap-2 pb-1" aria-hidden>
              {STEPS.map((_, i) => (
                <span key={i} className={`h-2.5 ${i === step ? "w-8 bg-[color:var(--color-text)]" : "w-2.5 bg-[color:var(--color-text-muted)] opacity-40"}`} />
              ))}
            </div>
            <button type="button" onClick={() => setStep(step + 1)} className="m-btn w-full">Lanjut</button>
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="min-h-12 w-full font-bold">Kembali</button>
            )}
          </>
        ) : (
          <>
            <button type="button" onClick={() => go("/latihan")} className="m-btn w-full">Coba latihan dulu</button>
            <button type="button" onClick={() => go("/masuk")} className="m-btn m-btn--line w-full">Masuk dengan nomor ponsel</button>
          </>
        )}
      </div>
    </main>
  );
}
