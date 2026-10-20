import { Check, CircleDot } from "lucide-react";
import type { GameState } from "@/lib/game/types";

export function Players({ state, lobby = false }: { state: GameState; lobby?: boolean }) {
  return <section aria-label="Játékosok" className={lobby ? "panel p-5 sm:p-6" : "mb-6"}>
    {lobby && <div className="mb-5 flex items-center justify-between"><h2 className="font-extrabold">Az asztalnál</h2><span className="badge bg-lime">{state.players.length} játékos</span></div>}
    <ol className={lobby ? "space-y-3" : "flex flex-wrap gap-2"}>
      {state.players.map((player) => {
        const mine = player.id === state.me_id;
        const active = state.game.status === "playing" && player.id === state.game.current_player_id;
        const initial = state.game.status === "initial_rating";
        return <li key={player.id} className={lobby ? "flex items-center gap-3" : `flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-xs ${active ? "border-ink bg-ink text-white" : "border-line bg-white/50"}`}>
          {lobby && <span className={`grid size-10 shrink-0 place-items-center rounded-xl text-sm font-black ${mine ? "bg-lilac" : "bg-paper"}`}>{String(player.join_order).padStart(2, "0")}</span>}
          {active && <CircleDot className="size-3.5 text-lime" aria-hidden="true" />}
          <span className={`min-w-0 break-words font-bold ${lobby ? "flex-1 text-sm" : ""}`}>{player.nickname}{mine && <span className={`ml-1 text-[10px] font-normal ${active ? "text-white/70" : "text-muted"}`}>(te)</span>}</span>
          {lobby ? <span className="text-xs text-muted">Csatlakozott</span>
            : initial ? <span className="flex items-center gap-1 text-muted">{player.initial_rated === 3 && <Check className="size-3 text-[#48612e]" aria-hidden="true" />}{player.initial_rated}/3</span>
              : <span className={`tabular-nums ${active ? "text-lime" : "text-muted"}`}>{player.card_count}/10</span>}
        </li>;
      })}
    </ol>
  </section>;
}
