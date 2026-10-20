"use client";

import { ArrowRight } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "./ui";

export function ScoreForm({ onSubmit, disabled, busy, initial = false }: {
  onSubmit: (score: number) => void; disabled: boolean; busy: boolean; initial?: boolean;
}) {
  const [score, setScore] = useState(50);
  const id = useId();
  return <form className="panel p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); if (!disabled) onSubmit(score); }}>
    <fieldset disabled={disabled}>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="max-w-44 text-base leading-snug font-bold">Mennyire rossz ez szerinted?</label>
        <div className="flex shrink-0 items-baseline gap-1"><output htmlFor={id} className="score text-6xl" aria-live="off">{score}</output><span className="text-sm text-muted">/100</span></div>
      </div>
      <div className="mt-5 px-1">
        <input id={id} className="range-control" type="range" min={1} max={100} step={1} value={score}
          onChange={(event) => setScore(Number(event.target.value))} aria-valuetext={`${score} pont a 100-ból`} />
      </div>
      <div className="mt-1 mb-6 flex justify-between text-xs text-muted"><span>1 · Túlélem</span><span>100 · Na, ezt ne.</span></div>
      <Button type="submit" className="w-full" busy={busy} disabled={disabled}>
        {initial ? "Pontszám véglegesítése" : "Értékelés beküldése"}<ArrowRight className="size-4" aria-hidden="true" />
      </Button>
      <p className="mt-3 text-center text-xs leading-relaxed text-muted">{initial ? "A saját mércéd. Véglegesítés után nem módosítható." : "Csak a kör végén fedjük fel a többieknek."}</p>
    </fieldset>
  </form>;
}
