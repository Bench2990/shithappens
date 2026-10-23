"use client";

import { CircleStop } from "lucide-react";
import { useRef } from "react";
import type { GameAction } from "@/lib/game/types";
import { Button, ErrorBanner } from "./ui";

export function CancelGame({ gameId, act, disabled, pending, error }: {
  gameId: string;
  act: (action: GameAction) => Promise<boolean>;
  disabled: boolean;
  pending: GameAction["type"] | null;
  error: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = pending === "cancel";

  async function confirm() {
    if (await act({ type: "cancel", gameId })) dialog.current?.close();
  }

  return <div className="mb-4 flex justify-end">
    <button type="button" aria-haspopup="dialog" disabled={disabled}
      className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold text-[#a3342e] hover:bg-coral/20 disabled:opacity-45"
      onClick={() => dialog.current?.showModal()}>
      <CircleStop className="size-4 shrink-0" aria-hidden="true" />Játék megszakítása
    </button>
    <dialog ref={dialog} aria-labelledby="cancel-game-title" aria-describedby="cancel-game-description"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-line bg-paper p-5 text-ink shadow-xl backdrop:bg-ink/50 sm:p-7"
      onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <h2 id="cancel-game-title" className="text-2xl font-black tracking-tight">Biztosan megszakítod a játékot?</h2>
      <p id="cancel-game-description" className="mt-4 text-sm leading-relaxed text-muted">A jelenlegi parti véget ér, minden játékos visszakerül a lobbyba, és az aktuális kártyák és pontszámok elvesznek az új játék szempontjából.</p>
      {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Mégse</Button>
        <Button type="button" variant="danger" disabled={disabled} busy={busy} onClick={() => { void confirm(); }}>Játék megszakítása</Button>
      </div>
    </dialog>
  </div>;
}
