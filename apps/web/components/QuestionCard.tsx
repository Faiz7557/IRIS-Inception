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
  const idx = Math.max(1, card.index);
  const titleId = `q-${card.card_id}`;

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={`card-in space-y-4 rounded-[16px] p-4 shadow-[var(--shadow-card)] outline-none ${
        instr ? "bg-[color:var(--color-warning-bg)]" : "bg-[color:var(--color-surface)]"
      } ${locked && status === "sent" ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {silentDot && <span className="h-3 w-3 rounded-full bg-[color:var(--color-primary)]" aria-label="Kartu baru" role="img" />}
        {CHIPS[card.degradation] && (
          <span className="rounded-full bg-[color:var(--color-warning-bg)] px-3 text-[16px] font-bold text-[color:var(--color-warning)]">
            {CHIPS[card.degradation]}
          </span>
        )}
      </div>

      {!l1 && card.transcript && (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Kata operator: ${card.transcript}`}
          onClick={() => setOpen(!open)}
          className={`w-full rounded-[12px] bg-[color:var(--color-bg)] p-3 text-left text-[16px] leading-6 text-[color:var(--color-text-muted)] ${open ? "" : "line-clamp-3"}`}
        >
          {card.transcript}
        </button>
      )}

      {instr && (
        <div className="flex justify-center text-[color:var(--color-warning)]" role="img" aria-label={card.question}>
          <CheckIcon size={96} />
        </div>
      )}

      <h2
        id={titleId}
        aria-live="assertive"
        className={`font-bold ${l1 ? "text-[24px] leading-8" : "text-[32px] leading-10"}`}
      >
        {l1 ? card.transcript || card.question : card.question}
      </h2>

      <div role="group" aria-labelledby={titleId} className={grid ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3"}>
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
              className={`flex min-h-[64px] items-center justify-center gap-2 rounded-[12px] px-4 text-[18px] font-bold ${
                mine && status === "sent"
                  ? "bg-[color:var(--color-success)] text-white"
                  : dont
                    ? "border-2 border-[color:var(--color-primary)] bg-[color:var(--color-surface)] text-[color:var(--color-accent)]"
                    : "bg-[color:var(--color-primary)] text-white"
              } ${dim ? "opacity-40" : ""}`}
            >
              {o.action === "kirim_gps" && <GpsIcon size={24} />}
              <span className="flex flex-col items-center leading-6">
                <span>{mine && status === "sending" ? t("call.sending") : mine && status === "sent" ? t("call.sent") : o.label}</span>
                {sub && !mine && <span className="text-[16px] font-normal">{sub}</span>}
              </span>
              {mine && status === "sent" && <CheckIcon size={24} />}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-disabled={locked || undefined}
          onClick={() => !locked && onRepeat()}
          className="min-h-[56px] px-2 text-[18px] font-bold text-[color:var(--color-accent)]"
        >
          {t("call.repeat")}
        </button>
        {card.total > 1 && (
          <span className="text-[16px] text-[color:var(--color-text-muted)]">
            Kartu {Math.min(idx, card.total)} dari {card.total}
          </span>
        )}
      </div>
      {pendingAfter > 0 && (
        <p className="text-[16px] text-[color:var(--color-text-muted)]">{pendingAfter} pertanyaan lagi menunggu</p>
      )}
    </section>
  );
});
