import Link from "next/link";
import { ArrowLeftIcon } from "./icons";

export type Tone = "ink" | "orange" | "mustard" | "sage" | "violet" | "mauve" | "taupe";

/** Sill head: wordmark bar, then a flat colour panel with the page title rising word by word. */
export function PageHead({ title, lead, back, tone = "ink" }: { title: string; lead?: string; back?: string; tone?: Tone }) {
  return (
    <header className="mx-auto w-full max-w-[480px] px-2">
      <div className="s-bar">
        <Link href="/" className="s-word" aria-label="Jembatan 112, ke beranda">
          J112
        </Link>
        {back && (
          <Link href={back} className="m-btn m-btn--sm !pl-3.5">
            <ArrowLeftIcon size={20} />
            Kembali
          </Link>
        )}
      </div>
      <div className={`s-panel tone-${tone}`}>
        <h1 className="s-title">
          <Words text={title} />
        </h1>
        {lead && <p className="mt-4 text-[18px] leading-7">{lead}</p>}
      </div>
    </header>
  );
}

/** Each word in its own mask so the heading rises the way the template's split lines do. */
export function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={i}>
          <span className="w">
            <span style={{ "--d": i } as React.CSSProperties}>{w}</span>
          </span>{" "}
        </span>
      ))}
    </>
  );
}
