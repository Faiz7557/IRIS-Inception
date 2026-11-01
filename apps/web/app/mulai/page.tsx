"use client";
import { useRouter } from "next/navigation";
import { Words } from "@/components/PageHead";

// Screen 1 (brief §7): three steps, skippable, shown once. Panels and motion from the 8B "Sill" template.
const STEPS = [
  { t: "Pilih kejadian", d: "Ketuk salah satu dari enam ubin: kebakaran, kecelakaan, sakit, kejahatan, KDRT, atau bencana.", tone: "tone-orange" },
  { t: "Tahan SOS 3 detik", d: "Tahan tombol merah selama 3 detik. Sistem menelepon 112 dan membacakan pesan untuk Anda.", tone: "tone-mustard" },
  { t: "Jawab dengan tombol", d: "Pertanyaan operator tampil sebagai kartu. Ketuk jawaban, sistem yang membacakannya.", tone: "tone-sage" },
];
const FAQ = [
  [
    "Apakah ini menelepon 112 sungguhan?",
    "Belum. Prototipe ini tersambung ke konsol operator simulasi. Akun baru juga mulai di mode latihan.",
  ],
  ["Bagaimana operator tahu jawaban saya?", "Anda mengetuk tombol jawaban. Sistem membacakannya dengan suara ke operator."],
  [
    "Bagaimana bila internet putus?",
    "Aplikasi menyiapkan teks SMS berisi kejadian dan lokasi Anda. Tinggal kirim ke kontak darurat.",
  ],
  ["Siapa yang tahu kondisi medis saya?", "Hanya operator, dan hanya bila Anda setuju di profil."],
  ["Bisa dipakai diam-diam?", "Bisa. Mode senyap membuat layar gelap, tanpa getar dan tanpa bunyi."],
];

export default function Mulai() {
  const r = useRouter();
  const done = () => {
    try { localStorage.setItem("j112.seen_intro", "1"); } catch { /* ignore */ }
    r.replace("/masuk");
  };

  return (
    <>
      <header className="l-nav">
        <a className="s-word" href="#hero" aria-label="Jembatan 112, ke atas">
          J112
        </a>
        <nav className="l-nav__links" aria-label="Di halaman ini">
          <a className="m-link" href="#cara">Cara pakai</a>
          <a className="m-link" href="#tanya">Pertanyaan</a>
        </nav>
        <button type="button" onClick={done} className="m-btn m-btn--sm">
          Lewati
        </button>
      </header>

      <main className="l-main">
        <section id="hero" className="l-hero" aria-labelledby="hero-title">
          <div className="s-panel tone-orange l-hero__title">
            <h1 id="hero-title" className="l-d1">
              <Words text="Minta tolong tanpa bicara." />
            </h1>
          </div>
          <div className="s-panel tone-ink l-hero__num" style={{ "--i": 1 } as React.CSSProperties} aria-hidden>
            <span className="l-112">112</span>
          </div>
          <p className="s-panel tone-violet l-hero__lead" style={{ "--i": 2 } as React.CSSProperties}>
            Jembatan 112 menghubungkan Anda dengan operator 112 tanpa perlu bicara. Untuk teman tuli dan teman yang sulit
            bicara.
          </p>
          <div className="s-panel tone-taupe l-hero__cta" style={{ "--i": 3 } as React.CSSProperties}>
            <p className="m-label">Prototipe · akun baru mulai di mode latihan</p>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
              <button type="button" onClick={done} className="m-btn">
                Mulai
              </button>
              <a className="m-link" href="/latihan">Coba latihan dulu</a>
            </div>
          </div>
        </section>

        <section id="cara" className="l-steps" aria-labelledby="cara-title">
          <div className="s-panel m-surface l-reveal l-steps__head">
            <h2 id="cara-title" className="l-d2">Tiga langkah.</h2>
            <p className="mt-4 text-[20px] leading-7">Sekali dipelajari, bisa dipakai saat panik.</p>
          </div>
          <ol className="l-stair">
            {STEPS.map((s, i) => (
              <li key={s.t} className={`s-panel l-reveal ${s.tone}`} style={{ "--step": i } as React.CSSProperties}>
                <span className="l-num" aria-hidden>{i + 1}</span>
                <p className="m-label mt-auto">Langkah {i + 1} dari {STEPS.length}</p>
                <h3 className="s-h2">{s.t}</h3>
                <p className="mt-3 text-[17px] leading-6">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="tanya" className="l-faq" aria-labelledby="tanya-title">
          <div className="s-panel tone-mauve l-reveal l-faq__head">
            <h2 id="tanya-title" className="l-d2">Pertanyaan.</h2>
          </div>
          <div className="grid gap-2">
            {FAQ.map(([q, a]) => (
              <details key={q} className="m-surface l-reveal l-faq__item">
                <summary>
                  <span className="s-display text-[22px] leading-7 font-extrabold tracking-[-0.02em]">{q}</span>
                  <span className="l-faq__mark" aria-hidden />
                </summary>
                <p className="pb-5 text-[18px] leading-7 text-[var(--color-text-muted)]">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="mulai" className="s-panel tone-ink l-reveal l-start" aria-labelledby="mulai-title">
          <h2 id="mulai-title" className="l-d1">Mulai.</h2>
          <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
            <p className="max-w-[28rem] text-[20px] leading-7">Masuk dengan nomor ponsel. Kami kirim kode 6 digit lewat SMS.</p>
            <button type="button" onClick={done} className="m-btn l-start__btn">
              Masuk sekarang
            </button>
          </div>
        </section>
      </main>

      <footer className="l-footer">
        <div className="s-panel tone-ink">
          <nav className="flex flex-wrap gap-x-6" aria-label="Kaki halaman">
            <a className="m-link" href="#cara">Cara pakai</a>
            <a className="m-link" href="#tanya">Pertanyaan</a>
            <a className="m-link" href="#mulai">Mulai</a>
          </nav>
          <p className="mt-6 text-[15px] opacity-80">
            © 2026 Jembatan 112 · Design: <a className="underline" href="https://8b.com/templates/sill/">8B Sill</a>
          </p>
          <p className="l-wordmark" aria-hidden>
            Jembatan 112
          </p>
        </div>
      </footer>
    </>
  );
}
