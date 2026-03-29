export type SeatId = 'A' | 'B';

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
  current_player: SeatId;
  scores: Record<string, number>;
  turn_points: number;
  remaining_dice: number;
  current_roll: number[];
  phase: GamePhase;
  winner: SeatId | null;
  available_actions: AvailableActions;
}

export interface SeatPresence {
  occupied: boolean;
  connected: boolean;
}

export interface CursorState {
  focused_index: number | null;
  selected_indices: number[];
}

export interface RoomState {
  room_id: string;
  seats: Record<SeatId, SeatPresence>;
  cursors: Record<SeatId, CursorState>;
}

export interface RollPayload {
  player: SeatId;
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
  player: SeatId;
  selected_dice: number[];
  points_gained: number;
  turn_points: number;
  remaining_dice: number;
  hot_dice: boolean;
}

export interface TurnResultPayload {
  player: SeatId;
  banked_points: number;
  total_score: number;
  next_player: SeatId | null;
  won: boolean;
}

export interface GameActionResponse {
  message: string;
  snapshot: GameSnapshot;
  room: RoomState;
  roll?: RollPayload;
  preview?: PreviewPayload;
  take_result?: TakeResultPayload;
  turn_result?: TurnResultPayload;
}

export interface SessionInfo {
  room_id: string;
  seat: SeatId;
  seat_token: string;
}

export interface RoomSnapshotResponse {
  message: string;
  snapshot: GameSnapshot;
  room: RoomState;
}

export interface JoinRoomResponse {
  message: string;
  session: SessionInfo;
  snapshot: GameSnapshot;
  room: RoomState;
}

export interface RoomEvent {
  type: 'room_state' | 'game_state' | 'cursor_state';
  message: string;
  snapshot: GameSnapshot;
  room: RoomState;
  actor_seat: SeatId | null;
}
