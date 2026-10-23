export interface GameEvent {
  id: string;
  title: string;
  description: string;
}

export interface Player {
  id: string;
  nickname: string;
  join_order: number;
  card_count: number;
  initial_rated: number;
}

export interface PlayerCard {
  id: string;
  event: GameEvent;
  score_tenths: number;
  source: "initial" | "won";
}

export interface CurrentRound {
  id: string;
  number: number;
  active_player_id: string;
  event: GameEvent;
  ratings_count: number;
  ratings_expected: number;
  my_rating: number | null;
  selected_position: number | null;
}

export interface RoundResult {
  id: string;
  number: number;
  active_player_id: string;
  event: GameEvent;
  average_tenths: number;
  selected_position: number;
  lower_tenths: number | null;
  upper_tenths: number | null;
  correct: boolean;
  card_count_after: number;
  ratings: { player_id: string; nickname: string; value: number }[];
}

export interface GameState {
  revision: number;
  me_id: string | null;
  player_count: number;
  events_available: number;
  events_required: number;
  game: {
    id: string;
    status: "lobby" | "initial_rating" | "playing" | "finished";
    starting_player_id: string | null;
    current_player_id: string | null;
    winner_id: string | null;
    end_reason: "winner" | "exhausted" | "cancelled" | null;
    round_number: number;
  };
  players: Player[];
  my_cards: PlayerCard[];
  initial_card: { id: string; order: number; event: GameEvent } | null;
  current_round: CurrentRound | null;
  latest_result: RoundResult | null;
  cancellation: { game_id: string; nickname: string; cancelled_at: string } | null;
}

export type GameAction =
  | { type: "join"; gameId: string; nickname: string }
  | { type: "start"; gameId: string }
  | { type: "initial"; gameId: string; cardId: string; score: number }
  | { type: "rate"; gameId: string; roundId: string; score: number }
  | { type: "select"; gameId: string; roundId: string; position: number }
  | { type: "finalize"; gameId: string; roundId: string }
  | { type: "cancel"; gameId: string }
  | { type: "restart"; gameId: string };

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";
