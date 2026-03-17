export type GamePhase =
  | 'ready_to_roll'
  | 'awaiting_selection'
  | 'can_bank_or_continue'
  | 'farkle'
  | 'game_over';

export interface AvailableActions {
  new_game: boolean;
  roll: boolean;
  take_selection: boolean;
  continue_turn: boolean;
  bank_turn: boolean;
  resolve_farkle: boolean;
}

export interface GameSnapshot {
  target_score: number;
  current_player: string;
  scores: Record<string, number>;
  turn_points: number;
  remaining_dice: number;
  current_roll: number[];
  phase: GamePhase;
  winner: string | null;
  available_actions: AvailableActions;
}

export interface RollPayload {
  player: string;
  dice: number[];
  has_scoring_option: boolean;
}

export interface PreviewPayload {
  indices: number[];
  dice: number[];
  points: number;
  is_valid: boolean;
}

export interface TakeResultPayload {
  player: string;
  selected_dice: number[];
  points_gained: number;
  turn_points: number;
  remaining_dice: number;
  hot_dice: boolean;
}

export interface TurnResultPayload {
  player: string;
  banked_points: number;
  total_score: number;
  next_player: string | null;
  won: boolean;
}

export interface GameActionResponse {
  message: string;
  snapshot: GameSnapshot;
  roll?: RollPayload;
  preview?: PreviewPayload;
  take_result?: TakeResultPayload;
  turn_result?: TurnResultPayload;
}
