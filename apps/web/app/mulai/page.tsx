"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const STEPS = [
  { t: "Pilih kejadian", d: "Ketuk salah satu dari enam ubin: kebakaran, kecelakaan, sakit, kejahatan, KDRT, atau bencana." },
  { t: "Tahan SOS 3 detik", d: "Tahan tombol merah selama 3 detik. Sistem menelepon 112 dan membacakan pesan untuk Anda." },
  { t: "Jawab dengan tombol", d: "Pertanyaan operator tampil sebagai kartu. Ketuk jawaban, sistem yang membacakannya." },
];

export default function Mulai() {
  const r = useRouter();
  const [i, setI] = useState(0);
  const done = () => {
    try { localStorage.setItem("j112.seen_intro", "1"); } catch { /* ignore */ }
    r.replace("/masuk");
  };
  const last = i === STEPS.length - 1;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between p-6 text-[var(--color-text)]">
      <button onClick={done} className="min-h-12 self-end px-3 text-[var(--color-text-muted)] underline">Lewati</button>
      <section aria-live="polite">
        <p className="text-sm text-[var(--color-text-muted)]">Langkah {i + 1} dari {STEPS.length}</p>
        <h1 className="mt-2 text-3xl font-bold">{STEPS[i].t}</h1>
        <p className="mt-4 text-lg">{STEPS[i].d}</p>
      </section>
      <button
        onClick={() => (last ? done() : setI(i + 1))}
        className="min-h-14 rounded-xl bg-[var(--color-primary)] text-lg font-bold text-white"
      >
        {last ? "Mulai" : "Lanjut"}
      </button>
    </main>
  );
}
