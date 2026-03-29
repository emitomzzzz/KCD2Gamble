import type {
  GameActionResponse,
  JoinRoomResponse,
  RoomSnapshotResponse,
  SeatId,
  SessionInfo,
} from '../types/game';

interface NewGamePayload {
  target_score: number;
  seed?: number;
}

interface SelectionPayload {
  indices: number[];
}

interface JoinRoomPayload {
  room_id?: string;
  seat: SeatId;
  seat_token?: string | null;
}

interface LeaveRoomPayload {
  room_id: string;
  seat: SeatId;
  seat_token: string;
}

const API_BASE = '/api';
export const DEFAULT_ROOM_ID = 'lan';

let sessionInfo: SessionInfo | null = null;

export function setSessionInfo(nextSession: SessionInfo | null): void {
  sessionInfo = nextSession;
}

export function getSessionInfo(): SessionInfo | null {
  return sessionInfo;
}

function buildHeaders(initHeaders?: HeadersInit): HeadersInit {
  const headers = new Headers(initHeaders ?? {});
  headers.set('Content-Type', 'application/json');

  if (sessionInfo) {
    headers.set('X-Room-Id', sessionInfo.room_id);
    headers.set('X-Seat', sessionInfo.seat);
    headers.set('X-Seat-Token', sessionInfo.seat_token);
  }

  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: buildHeaders(init?.headers),
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getRoomState(roomId = DEFAULT_ROOM_ID): Promise<RoomSnapshotResponse> {
  const query = new URLSearchParams({ room_id: roomId });
  return request<RoomSnapshotResponse>(`/room?${query.toString()}`);
}

export async function joinRoom(payload: JoinRoomPayload): Promise<JoinRoomResponse> {
  const response = await request<JoinRoomResponse>('/room/join', {
    method: 'POST',
    body: JSON.stringify({ room_id: DEFAULT_ROOM_ID, ...payload }),
  });
  setSessionInfo(response.session);
  return response;
}

export async function leaveRoom(): Promise<RoomSnapshotResponse | null> {
  if (!sessionInfo) {
    return null;
  }

  const payload: LeaveRoomPayload = {
    room_id: sessionInfo.room_id,
    seat: sessionInfo.seat,
    seat_token: sessionInfo.seat_token,
  };
  const response = await request<RoomSnapshotResponse>('/room/leave', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setSessionInfo(null);
  return response;
}

export function buildRoomSocketUrl(session: SessionInfo): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({
    seat: session.seat,
    seat_token: session.seat_token,
  });
  return `${protocol}//${window.location.host}/ws/rooms/${encodeURIComponent(session.room_id)}?${params.toString()}`;
}

export function newGame(payload: NewGamePayload): Promise<GameActionResponse> {
  return request<GameActionResponse>('/new-game', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function rollDice(): Promise<GameActionResponse> {
  return request<GameActionResponse>('/roll', { method: 'POST' });
}

export function previewSelection(indices: number[]): Promise<GameActionResponse> {
  const payload: SelectionPayload = { indices };
  return request<GameActionResponse>('/preview-selection', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function takeSelection(indices: number[]): Promise<GameActionResponse> {
  const payload: SelectionPayload = { indices };
  return request<GameActionResponse>('/take-selection', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function continuePlaying(): Promise<GameActionResponse> {
  return request<GameActionResponse>('/continue-turn', { method: 'POST' });
}

export function bankCurrentTurn(): Promise<GameActionResponse> {
  return request<GameActionResponse>('/bank-turn', { method: 'POST' });
}

export function resolveFarkleTurn(): Promise<GameActionResponse> {
  return request<GameActionResponse>('/resolve-farkle', { method: 'POST' });
}
