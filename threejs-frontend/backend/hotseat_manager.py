from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field

from dicegame.constants import DEFAULT_TARGET_SCORE
from dicegame.engine import DiceGameEngine
from .room_manager import CursorState, SEATS, SeatId

HOTSEAT_ROOM_ID = 'hotseat'
HOTSEAT_STALE_SECONDS = 60 * 60 * 6


class HotseatSessionNotFoundError(Exception):
    pass


@dataclass(slots=True)
class HotseatSession:
    token: str
    room_id: str = HOTSEAT_ROOM_ID
    engine: DiceGameEngine = field(default_factory=lambda: DiceGameEngine(target_score=DEFAULT_TARGET_SCORE))
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    cursors: dict[SeatId, CursorState] = field(
        default_factory=lambda: {seat: CursorState() for seat in SEATS}
    )
    updated_at: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.updated_at = time.monotonic()

    def is_stale(self) -> bool:
        return (time.monotonic() - self.updated_at) >= HOTSEAT_STALE_SECONDS

    def set_cursor_state(self, seat: SeatId, focused_index: int | None, selected_indices: list[int]) -> None:
        self.touch()
        self.cursors[seat] = CursorState(
            focused_index=focused_index,
            selected_indices=list(selected_indices),
        )

    def clear_cursor_state(self, seat: SeatId) -> None:
        self.touch()
        self.cursors[seat] = CursorState()

    def clear_all_cursor_states(self) -> None:
        for seat in SEATS:
            self.clear_cursor_state(seat)

    def room_state_dict(self) -> dict[str, object]:
        self.touch()
        return {
            'room_id': self.room_id,
            'seats': {
                seat: {
                    'occupied': True,
                    'connected': True,
                }
                for seat in SEATS
            },
            'cursors': {
                seat: {
                    'focused_index': self.cursors[seat].focused_index,
                    'selected_indices': list(self.cursors[seat].selected_indices),
                }
                for seat in SEATS
            },
        }


class HotseatManager:
    def __init__(self) -> None:
        self._sessions: dict[str, HotseatSession] = {}
        self._lock = asyncio.Lock()

    def _cleanup_stale_sessions(self) -> None:
        stale_tokens = [token for token, session in self._sessions.items() if session.is_stale()]
        for token in stale_tokens:
            self._sessions.pop(token, None)

    async def create_or_restore(self, requested_token: str | None = None) -> HotseatSession:
        async with self._lock:
            self._cleanup_stale_sessions()
            token = requested_token or secrets.token_urlsafe(24)
            session = self._sessions.get(token)
            if session is not None:
                session.touch()
                return session

            while token in self._sessions:
                token = secrets.token_urlsafe(24)

            session = HotseatSession(token=token)
            self._sessions[token] = session
            return session

    async def get_session(self, token: str) -> HotseatSession:
        async with self._lock:
            self._cleanup_stale_sessions()
            session = self._sessions.get(token)
            if session is None:
                raise HotseatSessionNotFoundError('Hotseat session was not found or has expired.')
            session.touch()
            return session

    async def release_session(self, token: str) -> None:
        async with self._lock:
            self._sessions.pop(token, None)
