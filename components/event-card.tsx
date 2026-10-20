import { LockKeyhole } from "lucide-react";
import type { GameEvent } from "@/lib/game/types";

export function EventCard({ event, label = "Az aktuális szar ügy", initial = false }: { event: GameEvent; label?: string; initial?: boolean }) {
  return <article className="enter relative overflow-hidden rounded-3xl border border-ink/10 bg-lilac p-6 sm:p-8">
    <div aria-hidden="true" className="pointer-events-none absolute -top-10 -right-8 size-40 rounded-full border-[28px] border-white/10" />
    <div className="relative">
      <div className="mb-8 flex items-center justify-between gap-3">
        <span className="eyebrow">{label}</span>
        <span className="badge shrink-0 bg-ink/10"><LockKeyhole className="size-3" aria-hidden="true" />{initial ? "Te döntesz" : "Titkos pontszám"}</span>
      </div>
      <h2 className="max-w-md text-[28px] leading-[1.12] font-black tracking-tight sm:text-4xl">{event.title}</h2>
      <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink/85">{event.description}</p>
    </div>
  </article>;
}
