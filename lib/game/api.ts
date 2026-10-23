import { getSupabase } from "../supabase/client";
import type { GameAction, GameState } from "./types";

export async function fetchGameState(): Promise<GameState> {
  const { data, error } = await getSupabase().rpc("get_game_state");
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data) || !("game" in data)) {
    throw new Error("A szerver nem adott érvényes játékállapotot. Ellenőrizd az SQL-migrációt.");
  }
  return data as unknown as GameState;
}

export async function executeAction(action: GameAction): Promise<void> {
  const client = getSupabase();
  const p_game_id = action.gameId;
  const result = await (() => {
    switch (action.type) {
      case "join": return client.rpc("join_game", { p_game_id, p_nickname: action.nickname });
      case "leave": return client.rpc("leave_lobby", { p_game_id, p_player_id: action.playerId });
      case "reset": return client.rpc("reset_lobby", { p_game_id });
      case "start": return client.rpc("start_game", { p_game_id });
      case "initial": return client.rpc("rate_initial_card", { p_game_id, p_card_id: action.cardId, p_score: action.score });
      case "rate": return client.rpc("rate_round", { p_game_id, p_round_id: action.roundId, p_score: action.score });
      case "select": return client.rpc("select_placement", { p_game_id, p_round_id: action.roundId, p_position: action.position });
      case "finalize": return client.rpc("finalize_placement", { p_game_id, p_round_id: action.roundId });
      case "cancel": return client.rpc("cancel_game", { p_game_id });
      case "restart": return client.rpc("restart_game", { p_game_id });
    }
  })();
  if (result.error) throw result.error;
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message
    : typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return "A névtelen belépés nincs bekapcsolva. Engedélyezd a Supabase Authentication beállításaiban.";
  }
  if (/rate limit|too many requests/i.test(message)) {
    return "Túl sok belépési kísérlet. Várj egy kicsit, majd próbáld újra.";
  }
  if (/invalid api key|invalid supabase/i.test(message)) {
    return "A Supabase címe vagy publikus API-kulcsa hibás. Ellenőrizd a környezeti változókat, majd indítsd újra az alkalmazást.";
  }
  if (/refresh token|jwt expired|invalid jwt/i.test(message)) {
    return "A névtelen munkamenet nem frissíthető. Nyisd meg újra az oldalt ugyanebben a böngészőben; ne töröld a webhelyadatait.";
  }
  if (/fetch|network|load failed|timeout|abort/i.test(message)) {
    return "Nem érjük el az asztalt. Ellenőrizd a kapcsolatot; a már mentett lapjaid megmaradnak.";
  }
  if (/could not find the function|schema cache/i.test(message)) {
    return "Hiányzik az adatbázis játékfunkciója. Futtasd a supabase/migrations SQL-fájlt.";
  }
  if (/permission denied/i.test(message)) {
    return "Az adatbázis nem engedélyezi ezt a hozzáférést. Ellenőrizd, hogy a teljes SQL-migráció lefutott-e.";
  }
  if (/[áéíóöőúüű]/i.test(message)) return message;
  return "Valami félrement. Próbáld újra; a mentett játékállapot megmarad. A részletes szerverválasz a böngésző hálózati naplójában található.";
}
