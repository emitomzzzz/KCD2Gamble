import type { GameActionResponse } from '../types/game';

interface NewGamePayload {
  target_score: number;
  seed?: number;
}

interface SelectionPayload {
  indices: number[];
}

const API_BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getGame(): Promise<GameActionResponse> {
  return request<GameActionResponse>('/game');
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
