"use client";

import { LogOut, RotateCcw } from "lucide-react";
import { useRef } from "react";
import type { GameAction } from "@/lib/game/types";
import { Button, ErrorBanner } from "./ui";

export function LobbyActions({ gameId, playerId, act, disabled, pending, error }: {
  gameId: string;
  playerId: string;
  act: (action: GameAction) => Promise<boolean>;
  disabled: boolean;
  pending: GameAction["type"] | null;
  error: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = pending === "reset";

  async function confirm() {
    if (await act({ type: "reset", gameId })) dialog.current?.close();
  }

  return <div className="mt-6 border-t border-line pt-5">
    <div className="grid gap-3 sm:grid-cols-2">
      <Button type="button" variant="secondary" disabled={disabled} busy={pending === "leave"}
        onClick={() => { void act({ type: "leave", gameId, playerId }); }}>
        <LogOut className="size-4 shrink-0" aria-hidden="true" />Kilépés a lobbiból
      </Button>
      <button type="button" aria-haspopup="dialog" disabled={disabled}
        className="flex min-h-[54px] items-center justify-center gap-2 rounded-2xl border border-[#d8a58f] px-4 py-3 text-sm font-bold text-[#a3342e] hover:bg-coral/20 disabled:opacity-45"
        onClick={() => dialog.current?.showModal()}>
        <RotateCcw className="size-4 shrink-0" aria-hidden="true" />Új lobby létrehozása
      </button>
    </div>
    <dialog ref={dialog} aria-labelledby="reset-lobby-title" aria-describedby="reset-lobby-description"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-line bg-paper p-5 text-ink shadow-xl backdrop:bg-ink/50 sm:p-7"
      onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <h2 id="reset-lobby-title" className="text-2xl font-black tracking-tight">Biztosan új lobbyt szeretnél létrehozni?</h2>
      <p id="reset-lobby-description" className="mt-4 text-sm leading-relaxed text-muted">A jelenlegi lobby megszűnik, minden játékos kikerül belőle, és újra csatlakozhattok egy üres lobbyhoz.</p>
      {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Mégse</Button>
        <Button type="button" variant="danger" disabled={disabled} busy={busy} onClick={() => { void confirm(); }}>Új lobby létrehozása</Button>
      </div>
    </dialog>
  </div>;
}
