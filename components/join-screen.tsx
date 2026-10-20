"use client";

import { ArrowRight, LockKeyhole, Users } from "lucide-react";
import { useEffect, useRef } from "react";
import type { GameState } from "@/lib/game/types";
import { Button } from "./ui";

export function JoinScreen({ state, disabled, busy, onJoin }: {
  state: GameState; disabled: boolean; busy: boolean; onJoin: (nickname: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try { if (input.current) input.current.value = localStorage.getItem("szar-ugy-nickname") ?? ""; }
    catch { /* A becenév csak kényelmi tipp, nem azonosító. */ }
  }, []);
  const closed = state.game.status !== "lobby";

  return <div className="enter mx-auto grid max-w-4xl items-center gap-9 py-4 sm:py-10 md:grid-cols-[1.1fr_1fr] md:gap-16">
    <div>
      <span className="badge mb-6 border border-ink/15 bg-lime"><Users className="size-3" aria-hidden="true" />Egy társaság. Sokféle ingerküszöb.</span>
      <h1 className="text-[clamp(2.8rem,8vw,4.4rem)] leading-[.98] font-black tracking-[-.065em]">Az élet szívás.<br /><span className="relative inline-block mt-2">De mennyire?<span aria-hidden="true" className="absolute -bottom-2 -left-1 -z-10 h-4 w-full -rotate-2 bg-lilac" /></span></h1>
      <p className="mt-8 max-w-sm text-base leading-relaxed text-muted">Rossz történetek, teljesen szubjektív pontszámok. Találd el, hová fér be a következő szar ügy a saját lapjaid közé.</p>
      <div className="mt-7 flex max-w-sm items-center gap-4 border-t border-line pt-6">
        <div className="score text-5xl">10</div><p className="text-sm leading-relaxed"><strong>lap a győzelemhez.</strong><br /><span className="text-muted">A rossz hír: mindenki más pontoz.</span></p>
      </div>
    </div>
    <section className="panel p-6 shadow-[0_12px_50px_-28px_#29212f50] sm:p-8">
      {closed ? <>
        <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-lilac/35"><LockKeyhole className="size-5" aria-hidden="true" /></span>
        <h2 className="text-2xl font-black tracking-tight">Ez az asztal most foglalt.</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">{state.game.status === "finished" ? "A parti véget ért. Az egyik résztvevő megnyithatja az új várót; az oldal automatikusan frissül." : `A parti már elindult ${state.player_count} játékossal. Új résztvevő a következő váróban csatlakozhat.`}</p>
        <p className="mt-5 border-t border-line pt-5 text-xs leading-relaxed text-muted">Már csatlakoztál korábban? Ugyanazt a böngészőt és eszközt használd. A becenév nem helyettesíti a böngészőben megőrzött névtelen azonosítót.</p>
      </> : <>
        <p className="eyebrow mb-2 text-muted">Helyet neked is</p>
        <h2 className="text-2xl font-black tracking-tight">Ülj az asztalhoz.</h2>
        <p className="mt-2 text-sm text-muted">Nincs regisztráció. Csak egy becenév kell.</p>
        <form className="mt-7" onSubmit={(event) => {
          event.preventDefault();
          const nickname = String(new FormData(event.currentTarget).get("nickname") ?? "").trim();
          if (!disabled && nickname.length >= 2) {
            try { localStorage.setItem("szar-ugy-nickname", nickname); } catch { /* Opcionális. */ }
            onJoin(nickname);
          }
        }}>
          <label htmlFor="nickname" className="mb-2 block text-sm font-bold">Hogy szólítsunk?</label>
          <input ref={input} id="nickname" name="nickname" placeholder="A beceneved" autoComplete="nickname" required minLength={2} maxLength={24} disabled={disabled}
            className="min-h-14 w-full rounded-xl border border-line bg-paper px-4 text-base placeholder:text-muted/60 disabled:opacity-50" />
          <Button className="mt-4 w-full" type="submit" disabled={disabled} busy={busy}>Csatlakozás<ArrowRight className="size-4" aria-hidden="true" /></Button>
        </form>
        <div className="mt-6 flex items-center gap-2 text-xs text-muted"><span className="size-2 rounded-full bg-[#7c9452]" />{state.player_count === 0 ? "Te lehetsz az első az asztalnál." : `${state.player_count} játékos már vár a közös asztalnál.`}</div>
      </>}
    </section>
  </div>;
}
