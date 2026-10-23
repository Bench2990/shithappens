// Az RPC-felület szándékosan szűk: a titkos táblákhoz nincs kliens API.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      room_state: {
        Row: { id: number; current_game_id: string; revision: number; updated_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_game_state: { Args: Record<string, never>; Returns: Json };
      join_game: { Args: { p_game_id: string; p_nickname: string }; Returns: string };
      leave_lobby: { Args: { p_game_id: string; p_player_id: string }; Returns: undefined };
      reset_lobby: { Args: { p_game_id: string }; Returns: string };
      start_game: { Args: { p_game_id: string }; Returns: undefined };
      rate_initial_card: { Args: { p_game_id: string; p_card_id: string; p_score: number }; Returns: undefined };
      rate_round: { Args: { p_game_id: string; p_round_id: string; p_score: number }; Returns: undefined };
      select_placement: { Args: { p_game_id: string; p_round_id: string; p_position: number }; Returns: undefined };
      finalize_placement: { Args: { p_game_id: string; p_round_id: string }; Returns: undefined };
      cancel_game: { Args: { p_game_id: string }; Returns: string };
      restart_game: { Args: { p_game_id: string }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
