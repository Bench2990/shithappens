"use client";

import { Check, Layers3, Plus } from "lucide-react";
import { Fragment } from "react";
import { formatScore, placementLabel } from "@/lib/game/format";
import type { PlayerCard } from "@/lib/game/types";

export function Hand({ cards, selected = null, onSelect, disabled = false }: {
  cards: PlayerCard[]; selected?: number | null; onSelect?: (position: number) => void; disabled?: boolean;
}) {
  function slot(position: number) {
    if (!onSelect) return null;
    const chosen = selected === position;
    const description = placementLabel(cards[position - 1]?.score_tenths ?? null, cards[position]?.score_tenths ?? null);
    return <button type="button" aria-pressed={chosen} aria-label={`Elhelyezés: ${description}`} disabled={disabled}
      onClick={() => onSelect?.(position)}
      className={`my-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${chosen ? "border-[#795aaf] bg-lilac/35 text-[#4d3276]" : "border-line text-muted hover:border-[#795aaf] hover:bg-lilac/15"}`}>
      {chosen ? <Check className="size-4" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
      {chosen ? "Ide kerül az új lap" : description}
    </button>;
  }

  return <section aria-label="Saját kártyasor" className="panel p-4 sm:p-6">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-extrabold"><Layers3 className="size-4" aria-hidden="true" />A te kártyáid</h2>
      <span className="badge bg-ink text-white">{cards.length}/10 lap</span>
    </div>
    {onSelect && <p className="mb-3 text-xs leading-relaxed text-muted">Érints meg egy helyet. A választásodat véglegesítésig bármikor módosíthatod.</p>}
    {!cards.length && <p className="py-4 text-sm text-muted">A véglegesített lapjaid itt jelennek meg.</p>}
    <div>
      {cards.map((card, index) => <Fragment key={card.id}>
        {slot(index)}
        <article className="flex min-h-16 items-center gap-3 rounded-xl border border-line bg-paper/70 px-3 py-3">
          <span className="text-[10px] font-bold text-muted" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <h3 className="min-w-0 flex-1 text-sm leading-snug font-bold">{card.event.title}</h3>
          <span className="score rounded-lg bg-white px-2.5 py-1 text-2xl">{formatScore(card.score_tenths)}<span className="sr-only"> pont</span></span>
        </article>
      </Fragment>)}
      {slot(cards.length)}
    </div>
    <div className="mt-4 flex items-center justify-between text-[10px] font-bold tracking-wider text-muted uppercase"><span>Kevésbé rossz</span><span>Nagyon rossz →</span></div>
  </section>;
}
