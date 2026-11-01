"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PRACTICED_KEY, vibrate } from "@/lib/geo";
import { paintOf } from "@/lib/incidents";
import type { ClientCard, ClientOption } from "@/lib/protocol";
import { CallHeader } from "@/components/CallHeader";
import { QuestionCard, type AnswerStatus } from "@/components/QuestionCard";
import { RouteBoard, type Stop } from "@/components/RouteBoard";
import { ShortInputSheet } from "@/components/ShortInputSheet";
import { CheckIcon } from "@/components/icons";

type Step = { card: ClientCard; tip: string; spoken: string[] };

function card(i: number, kind: ClientCard["kind"], question: string, transcript: string, options: [string, ClientOption["action"]][]): ClientCard {
  return {
    card_id: `latihan-${i}`, kind, question, transcript, degradation: 0, turn_no: i + 1, index: 0, total: 1,
    options: options.map(([label, action], index) => ({ index, label, action })),
  };
}

// The same four card kinds a real call uses, in the order an operator usually asks. Nothing leaves the phone.
const STEPS: Step[] = [
  {
    card: card(0, "ya_tidak", "Ada orang terjebak?", "Baik, Bu. Apakah masih ada orang yang terjebak di dalam rumah?", [["Ya", "ucap"], ["Tidak", "ucap"], ["Tidak tahu", "ucap"]]),
    tip: "Pertanyaan operator jadi satu kalimat pendek. Ketuk jawabannya.",
    spoken: ["Ya, ada orang terjebak.", "Tidak ada orang terjebak.", "Saya tidak tahu."],
  },
  {
    card: card(1, "lokasi", "Di mana lokasinya?", "Tolong sebutkan alamat lengkap atau patokan terdekat.", [["Kirim lokasi GPS", "kirim_gps"], ["Tulis patokan", "ketik"]]),
    tip: "Untuk lokasi, kirim GPS atau tulis patokan singkat.",
    spoken: ["Lokasi GPS saya dibacakan.", ""],
  },
  {
    card: card(2, "angka", "Berapa orang terluka?", "Ada berapa orang yang terluka di sana?", [["0", "ucap"], ["1", "ucap"], ["2", "ucap"], ["3 atau lebih", "ucap"], ["Tidak tahu", "ucap"]]),
    tip: "Angka tampil sebagai kotak besar.",
    spoken: ["Tidak ada yang terluka.", "Satu orang terluka.", "Dua orang terluka.", "Tiga orang atau lebih terluka.", "Saya tidak tahu."],
  },
  {
    card: card(3, "instruksi", "Keluar dari rumah sekarang.", "Ibu segera keluar dari rumah, jangan kembali masuk, tunggu di luar.", [["Mengerti", "ucap"]]),
    tip: "Kartu kuning adalah arahan operator. Lakukan, lalu ketuk Mengerti.",
    spoken: ["Saya mengerti."],
  },
];

export default function LatihanPage() {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [status, setStatus] = useState<AnswerStatus>("idle");
  const [heard, setHeard] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ClientOption | null>(null);
  const [startedAt] = useState(() => Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cardRef = useRef<HTMLElement>(null);
  const done = i >= STEPS.length;
  const step = STEPS[Math.min(i, STEPS.length - 1)];
  const paint = paintOf("kebakaran");

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (done) {
      try {
        localStorage.setItem(PRACTICED_KEY, "1");
      } catch {
        /* the home dot just stays */
      }
    } else cardRef.current?.focus();
  }, [i, done]);

  // Same rhythm as a call: "Dibacakan…" while the TTS would speak, then "Terkirim", then the next card.
  const answer = (o: ClientOption, text?: string) => {
    setChosen(o.index);
    setStatus("sending");
    setHeard(text ?? step.spoken[o.index] ?? o.label);
    timers.current.push(
      setTimeout(() => {
        setStatus("sent");
        vibrate(50);
      }, 900),
      setTimeout(() => {
        setI((n) => n + 1);
        setChosen(null);
        setStatus("idle");
        setHeard(null);
      }, 2300),
    );
  };
  const choose = (o: ClientOption) => {
    if (chosen !== null) return;
    if (o.action === "ketik") return setSheet(o);
    answer(o);
  };

  const stops: Stop[] = [
    { label: "Tersambung ke 112", state: "done" },
    { label: "Operator tahu kebakaran dan alamat Anda", state: "done" },
    { label: "Operator bertanya", sub: i > 0 && !done ? `${i} pertanyaan dijawab` : undefined, state: done ? "done" : "current" },
    { label: "Petugas berangkat", state: done ? "done" : "todo" },
  ];

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px]">
      <CallHeader phase={done ? "ended" : "connected"} incident="kebakaran" startedAt={startedAt} practice onCancel={() => router.push("/")} />
      <main className="s-instant space-y-2 px-2 pt-2 pb-10">
        {done ? (
          <section className="space-y-2" aria-labelledby="ok-title">
            <div className="s-panel tone-sage flex items-center gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-ink text-sill-sage"><CheckIcon size={34} /></span>
              <h1 id="ok-title" className="s-title !text-[40px]">Latihan selesai</h1>
            </div>
            <div className="s-panel m-surface"><RouteBoard stops={stops} paint={paint} /></div>
            <p className="s-panel m-surface text-[18px] leading-7">
              Saat darurat sungguhan, alurnya sama: pilih kejadian, tahan SOS, lalu jawab kartu satu per satu.
            </p>
            <Link href="/" className="m-btn w-full">Ke beranda</Link>
            <button type="button" onClick={() => setI(0)} className="m-btn m-btn--line w-full">Ulangi latihan</button>
          </section>
        ) : (
          <>
            <h1 className="sr-only">Latihan menjawab operator</h1>
            <p className="tone-mustard px-[18px] py-3 text-[17px] leading-6 font-bold">
              <span className="mr-2 font-mono">{i + 1}/{STEPS.length}</span>
              {step.tip}
            </p>
            <RouteBoard stops={stops} paint={paint} compact />
            <QuestionCard
              key={step.card.card_id}
              ref={cardRef}
              card={step.card}
              chosen={chosen}
              status={status}
              gpsAccuracy={12}
              pendingAfter={0}
              silentDot={false}
              onOption={choose}
              onRepeat={() => setHeard("Operator diminta mengulang. Kartu yang sama tetap tampil.")}
            />
            {heard && (
              <p role="status" className="m-band px-[18px] py-3 text-[17px] leading-6">
                <span className="m-label !text-inherit opacity-80">Operator mendengar</span>
                “{heard}”
              </p>
            )}
          </>
        )}
      </main>
      {sheet && (
        <ShortInputSheet
          suggestions={["Dekat masjid", "Depan minimarket", "Rumah cat hijau"]}
          onSend={(text) => {
            const o = sheet;
            setSheet(null);
            answer(o, text);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
