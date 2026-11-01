"use client";
import { forwardRef, useState } from "react";
import type { ClientCard, ClientOption } from "@/lib/protocol";
import { t } from "@/lib/copy";
import { CheckIcon, GpsIcon } from "./icons";

export type AnswerStatus = "idle" | "sending" | "sent";

const CHIPS: Record<number, string> = { 1: t("call.degraded"), 2: "Teks operator tidak tersedia", 3: "Suara terbatas" };

interface Props {
  card: ClientCard;
  chosen: number | null;
  status: AnswerStatus;
  gpsAccuracy: number | null;
  pendingAfter: number;
  silentDot: boolean;
  onOption: (o: ClientOption) => void;
  onRepeat: () => void;
}

/** One question card. Parent owns the socket; this only renders and reports taps. */
export const QuestionCard = forwardRef<HTMLElement, Props>(function QuestionCard(
  { card, chosen, status, gpsAccuracy, pendingAfter, silentDot, onOption, onRepeat }, ref,
) {
  const [open, setOpen] = useState(false);
  const locked = chosen !== null;
  const l1 = card.degradation === 1;
  const instr = card.kind === "instruksi";
  const grid = card.kind === "angka";
  const idx = card.index + 1; // server index is 0-based
  const titleId = `q-${card.card_id}`;

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={`card-in space-y-4 px-[18px] py-5 outline-none ${instr ? "tone-mustard" : "m-surface"}`}
    >
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        {silentDot && <span className={`h-3 w-3 rounded-full ${instr ? "bg-ink" : "bg-sill-mustard"}`} aria-label="Kartu baru" role="img" />}
        {CHIPS[card.degradation] && <span className="s-tag">{CHIPS[card.degradation]}</span>}
      </div>

      {instr && <p className="m-label">Arahan operator</p>}

      <h2
        id={titleId}
        aria-live="assertive"
        className={`s-display font-black tracking-[-0.03em] text-balance ${l1 ? "text-[26px] leading-8" : "text-[38px] leading-[40px]"}`}
      >
        {l1 ? card.transcript || card.question : card.question}
      </h2>

      <div role="group" aria-labelledby={titleId} className={grid ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
        {card.options.map((o) => {
          const mine = chosen === o.index;
          const dont = /tidak tahu/i.test(o.label);
          const dim = locked && !mine;
          const sub = o.action === "kirim_gps" && gpsAccuracy !== null ? `akurat ${gpsAccuracy} m` : null;
          return (
            <button
              key={o.index}
              type="button"
              aria-disabled={locked || undefined}
              onClick={() => !locked && onOption(o)}
              className={`m-press s-display flex min-h-[72px] items-center justify-center gap-2 px-4 text-[24px] font-black tracking-[-0.02em] transition-[background-color,opacity] duration-150 ease-out ${
                mine && status === "sent"
                  ? "bg-sill-sage text-ink"
                  : mine
                    ? "bg-sill-mustard text-ink"
                    : dont
                    ? "bg-transparent shadow-[inset_0_0_0_2px_currentColor]"
                    : instr
                      ? "bg-ink text-sill-mustard"
                      : "bg-primary text-on-primary"
              } ${dim ? "opacity-35" : ""}`}
            >
              {o.action === "kirim_gps" && <GpsIcon size={24} />}
              <span className="flex flex-col items-center leading-6">
                <span>{mine && status === "sending" ? t("call.sending") : mine && status === "sent" ? t("call.sent") : o.label}</span>
                {sub && !mine && <span className="text-[15px] font-bold opacity-80">{sub}</span>}
              </span>
              {mine && status === "sent" && <CheckIcon size={24} />}
            </button>
          );
        })}
      </div>

      {/* Raw operator speech is long spoken Indonesian, the hardest thing to read in a panic: folded below the answers. */}
      {!l1 && card.transcript && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={`min-h-12 text-[16px] font-semibold underline underline-offset-4 ${instr ? "" : "text-text-muted"}`}
          >
            {open ? "Tutup kata operator" : "Lihat kata operator"}
          </button>
          {open && (
            <p className={`p-3 text-[16px] leading-6 ${instr ? "bg-ink/10" : "bg-bg text-text-muted"}`}>
              {card.transcript}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-disabled={locked || undefined}
          onClick={() => !locked && onRepeat()}
          className="m-btn m-btn--sm m-btn--line"
        >
          {t("call.repeat")}
        </button>
        {card.total > 1 && (
          <span className={`text-[16px] font-semibold ${instr ? "text-ink/75" : "text-text-muted"}`}>
            Kartu {Math.min(idx, card.total)} dari {card.total}
          </span>
        )}
      </div>
      {pendingAfter > 0 && (
        <p className={`text-[16px] font-semibold ${instr ? "text-ink/75" : "text-text-muted"}`}>{pendingAfter} pertanyaan lagi menunggu</p>
      )}
    </section>
  );
});
