"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatScore, placementLabel } from "@/lib/game/format";
import type { Player, RoundResult as Result } from "@/lib/game/types";

export function RoundResult({ result, players, autoReveal = false, gameFinished = false }: {
  result: Result; players: Player[]; autoReveal?: boolean; gameFinished?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (autoReveal) panel.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "start",
    });
  }, [autoReveal]);
  const active = players.find((player) => player.id === result.active_player_id);
  const SuccessIcon = result.correct ? Check : X;
  return <section ref={panel} className="enter mb-7 scroll-mt-4 overflow-hidden rounded-3xl border border-ink/15 bg-white" aria-label={`${result.number}. kör eredménye`}>
    <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={`result-${result.id}`}
      className={`flex min-h-20 w-full items-center gap-3 p-5 text-left ${result.correct ? "bg-lime/60" : "bg-coral/60"}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-white"><SuccessIcon className="size-5" aria-hidden="true" /></span>
      <span className="flex-1"><span className="eyebrow block text-ink/65">{result.number}. kör eredménye · {active?.nickname}</span><span className="mt-1 block text-lg leading-tight font-black" aria-live="polite">{result.correct ? "Jó helyre került!" : "Ez most mellément."}</span></span>
      <ChevronDown className={`size-5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {expanded && <div id={`result-${result.id}`} className="p-5 sm:p-6">
      <h2 className="text-xl leading-tight font-black tracking-tight">{result.event.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{result.event.description}</p>
      <table className="mt-5 w-full text-sm">
        <caption className="sr-only">A játékosok felfedett értékelései</caption>
        <thead><tr className="border-b border-line text-xs text-muted"><th scope="col" className="pb-2 text-left font-normal">Játékos</th><th scope="col" className="pb-2 text-right font-normal">Pontszám</th></tr></thead>
        <tbody>{result.ratings.map((rating) => <tr key={rating.player_id} className="border-b border-line/60"><th scope="row" className="py-2.5 text-left font-semibold">{rating.nickname}</th><td className="py-2.5 text-right font-bold tabular-nums">{rating.value}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row" className="pt-4 text-left font-extrabold">A társaság átlaga</th><td className="score pt-3 text-right text-4xl">{formatScore(result.average_tenths, true)}</td></tr></tfoot>
      </table>
      <div className="mt-5 grid gap-2 rounded-xl bg-paper p-4 text-xs leading-relaxed">
        <p><span className="text-muted">Választott hely: </span><strong>{placementLabel(result.lower_tenths, result.upper_tenths)}</strong> <span className="text-muted">({result.selected_position + 1}. hely)</span></p>
        <p><strong>{active?.nickname}</strong> kártyái a kör után: <strong>{result.card_count_after}/10</strong>. {result.correct ? "A lap az övé." : "A lap visszakerült a húzhatók közé."}</p>
      </div>
      <p className="mt-3 text-[11px] text-muted">{gameFinished ? "A parti lezárult. Az utolsó kör pontozásai itt visszanézhetők." : "A következő kör már elindult. Ez az eredmény a következő lezárásig visszanézhető."}</p>
    </div>}
  </section>;
}
