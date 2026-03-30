import type { GameActionResponse, HotseatSessionInfo, HotseatSnapshotResponse } from '../types/game';

interface HotseatStartPayload {
  target_score: number;
  seed?: number;
}

interface SelectionPayload {
  indices: number[];
}

const API_BASE = '/api/hotseat';
let hotseatSessionInfo: HotseatSessionInfo | null = null;

export function setHotseatSessionInfo(session: HotseatSessionInfo | null): void {
  hotseatSessionInfo = session;
}

export function getHotseatSessionInfo(): HotseatSessionInfo | null {
  return hotseatSessionInfo;
}

function buildHeaders(initHeaders?: HeadersInit): HeadersInit {
  const headers = new Headers(initHeaders ?? {});
  headers.set('Content-Type', 'application/json');

  if (hotseatSessionInfo) {
    headers.set('X-Hotseat-Token', hotseatSessionInfo.session_token);
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

export async function startHotseatGame(payload: HotseatStartPayload): Promise<HotseatSnapshotResponse> {
  const response = await request<HotseatSnapshotResponse>('/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setHotseatSessionInfo(response.session);
  return response;
}

export function getHotseatState(): Promise<HotseatSnapshotResponse> {
  return request<HotseatSnapshotResponse>('/state');
}

export async function releaseHotseatGame(): Promise<void> {
  if (!hotseatSessionInfo) {
    return;
  }

  await request<{ status: string }>('/release', {
    method: 'POST',
  });
  setHotseatSessionInfo(null);
}

export function hotseatRollDice(): Promise<GameActionResponse> {
  return request<GameActionResponse>('/roll', { method: 'POST' });
}

export function hotseatPreviewSelection(indices: number[]): Promise<GameActionResponse> {
  const payload: SelectionPayload = { indices };
  return request<GameActionResponse>('/preview-selection', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function hotseatTakeSelection(indices: number[]): Promise<GameActionResponse> {
  const payload: SelectionPayload = { indices };
  return request<GameActionResponse>('/take-selection', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function hotseatContinuePlaying(): Promise<GameActionResponse> {
  return request<GameActionResponse>('/continue-turn', { method: 'POST' });
}

export function hotseatBankCurrentTurn(): Promise<GameActionResponse> {
  return request<GameActionResponse>('/bank-turn', { method: 'POST' });
}

export function hotseatResolveFarkleTurn(): Promise<GameActionResponse> {
  return request<GameActionResponse>('/resolve-farkle', { method: 'POST' });
}
