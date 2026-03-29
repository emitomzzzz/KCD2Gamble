from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Literal

from fastapi import WebSocket

from dicegame.constants import DEFAULT_TARGET_SCORE
from dicegame.engine import DiceGameEngine

SeatId = Literal['A', 'B']
SEATS: tuple[SeatId, SeatId] = ('A', 'B')
DEFAULT_ROOM_ID = 'lan'
SEAT_STALE_SECONDS = 300


class SeatOccupiedError(Exception):
    pass


class SeatTokenError(Exception):
    pass


@dataclass(slots=True)
class SeatReservation:
    token: str
    connected: bool = False
    updated_at: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.updated_at = time.monotonic()

    def is_stale(self) -> bool:
        return not self.connected and (time.monotonic() - self.updated_at) >= SEAT_STALE_SECONDS


@dataclass(slots=True)
class ConnectionMeta:
    websocket: WebSocket
    seat: SeatId | None
    seat_token: str | None


@dataclass(slots=True)
class CursorState:
    focused_index: int | None = None
    selected_indices: list[int] = field(default_factory=list)


class Room:
    def __init__(self, room_id: str) -> None:
        self.room_id = room_id
        self.engine = DiceGameEngine(target_score=DEFAULT_TARGET_SCORE)
        self.lock = asyncio.Lock()
        self.seats: dict[SeatId, SeatReservation | None] = {seat: None for seat in SEATS}
        self.cursors: dict[SeatId, CursorState] = {seat: CursorState() for seat in SEATS}
        self.connections: dict[WebSocket, ConnectionMeta] = {}

    def cleanup_stale_seats(self) -> None:
        for seat in SEATS:
            reservation = self.seats[seat]
            if reservation and reservation.is_stale():
                self.seats[seat] = None
                self.clear_cursor_state(seat)

    def join_seat(self, seat: SeatId, requested_token: str | None = None) -> str:
        self.cleanup_stale_seats()
        reservation = self.seats[seat]

        if reservation is not None:
            if requested_token and reservation.token == requested_token:
                reservation.touch()
                return reservation.token
            raise SeatOccupiedError(f'Seat {seat} is already occupied.')

        token = requested_token or secrets.token_urlsafe(24)
        self.seats[seat] = SeatReservation(token=token)
        self.clear_cursor_state(seat)
        return token

    def release_seat(self, seat: SeatId, seat_token: str) -> None:
        reservation = self.require_reservation(seat, seat_token)
        reservation.touch()
        self.seats[seat] = None
        self.clear_cursor_state(seat)

    def require_reservation(self, seat: SeatId, seat_token: str) -> SeatReservation:
        reservation = self.seats[seat]
        if reservation is None or reservation.token != seat_token:
            raise SeatTokenError(f'Seat {seat} is not reserved for this client.')
        reservation.touch()
        return reservation

    def register_connection(self, websocket: WebSocket, seat: SeatId | None, seat_token: str | None) -> None:
        if seat is not None:
            if seat_token is None:
                raise SeatTokenError(f'Seat {seat} requires a seat token.')
            reservation = self.require_reservation(seat, seat_token)
            reservation.connected = True
            reservation.touch()

        self.connections[websocket] = ConnectionMeta(
            websocket=websocket,
            seat=seat,
            seat_token=seat_token,
        )

    def unregister_connection(self, websocket: WebSocket) -> ConnectionMeta | None:
        meta = self.connections.pop(websocket, None)
        if meta is None or meta.seat is None or meta.seat_token is None:
            return meta

        reservation = self.seats.get(meta.seat)
        if reservation is None or reservation.token != meta.seat_token:
            return meta

        reservation.connected = self._has_live_connection(meta.seat, meta.seat_token)
        reservation.touch()
        if not reservation.connected:
            self.clear_cursor_state(meta.seat)
        return meta

    def _has_live_connection(self, seat: SeatId, seat_token: str) -> bool:
        for meta in self.connections.values():
            if meta.seat == seat and meta.seat_token == seat_token:
                return True
        return False

    def set_cursor_state(self, seat: SeatId, focused_index: int | None, selected_indices: list[int]) -> None:
        self.cursors[seat] = CursorState(
            focused_index=focused_index,
            selected_indices=list(selected_indices),
        )

    def clear_cursor_state(self, seat: SeatId) -> None:
        self.cursors[seat] = CursorState()

    def clear_all_cursor_states(self) -> None:
        for seat in SEATS:
            self.clear_cursor_state(seat)

    def room_state_dict(self) -> dict[str, object]:
        return {
            'room_id': self.room_id,
            'seats': {
                seat: {
                    'occupied': self.seats[seat] is not None,
                    'connected': bool(self.seats[seat].connected) if self.seats[seat] else False,
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

    async def broadcast(self, payload: dict[str, object], exclude: WebSocket | None = None) -> None:
        stale: list[WebSocket] = []

        for websocket in list(self.connections):
            if websocket is exclude:
                continue
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)

        if not stale:
            return

        async with self.lock:
            for websocket in stale:
                self.unregister_connection(websocket)


class RoomManager:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def get_room(self, room_id: str) -> Room:
        async with self._lock:
            room = self._rooms.get(room_id)
            if room is None:
                room = Room(room_id)
                self._rooms[room_id] = room
            return room
