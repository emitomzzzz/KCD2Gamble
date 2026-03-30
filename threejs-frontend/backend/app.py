from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

ROOT = Path(__file__).resolve().parents[2]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dicegame.constants import DEFAULT_TARGET_SCORE
from dicegame.engine import GameStateError
from .hotseat_api import router as hotseat_router
from .room_manager import (
    DEFAULT_ROOM_ID,
    SEATS,
    Room,
    RoomManager,
    SeatId,
    SeatOccupiedError,
    SeatTokenError,
)


class AvailableActions(BaseModel):
    new_game: bool
    roll: bool
    take_selection: bool
    continue_turn: bool
    bank_turn: bool
    resolve_farkle: bool


class GameSnapshot(BaseModel):
    target_score: int
    current_player: str
    scores: dict[str, int]
    turn_points: int
    remaining_dice: int
    current_roll: list[int]
    phase: str
    winner: str | None
    available_actions: AvailableActions


class SeatPresence(BaseModel):
    occupied: bool
    connected: bool


class CursorStatePayload(BaseModel):
    focused_index: int | None = None
    selected_indices: list[int] = Field(default_factory=list)


class RoomState(BaseModel):
    room_id: str
    seats: dict[str, SeatPresence]
    cursors: dict[str, CursorStatePayload]


class RollPayload(BaseModel):
    player: str
    dice: list[int]
    has_scoring_option: bool


class PreviewPayload(BaseModel):
    indices: list[int]
    dice: list[int]
    points: int
    is_valid: bool


class TakeResultPayload(BaseModel):
    player: str
    selected_dice: list[int]
    points_gained: int
    turn_points: int
    remaining_dice: int
    hot_dice: bool


class TurnResultPayload(BaseModel):
    player: str
    banked_points: int
    total_score: int
    next_player: str | None
    won: bool


class GameActionResponse(BaseModel):
    message: str
    snapshot: GameSnapshot
    room: RoomState
    roll: RollPayload | None = None
    preview: PreviewPayload | None = None
    take_result: TakeResultPayload | None = None
    turn_result: TurnResultPayload | None = None


class SessionInfo(BaseModel):
    room_id: str
    seat: SeatId
    seat_token: str


class RoomSnapshotResponse(BaseModel):
    message: str
    snapshot: GameSnapshot
    room: RoomState


class JoinRoomRequest(BaseModel):
    room_id: str = Field(default=DEFAULT_ROOM_ID, min_length=1, max_length=64)
    seat: Literal['A', 'B']
    seat_token: str | None = None


class JoinRoomResponse(BaseModel):
    message: str
    session: SessionInfo
    snapshot: GameSnapshot
    room: RoomState


class LeaveRoomRequest(BaseModel):
    room_id: str = Field(default=DEFAULT_ROOM_ID, min_length=1, max_length=64)
    seat: Literal['A', 'B']
    seat_token: str = Field(min_length=8)


class NewGameRequest(BaseModel):
    target_score: int = Field(default=DEFAULT_TARGET_SCORE, gt=0)
    seed: int | None = None


class SelectionRequest(BaseModel):
    indices: list[int] = Field(min_length=1)


class RoomEvent(BaseModel):
    type: Literal['room_state', 'game_state', 'cursor_state']
    message: str
    snapshot: GameSnapshot
    room: RoomState
    actor_seat: SeatId | None = None


class CursorStateUpdateMessage(BaseModel):
    type: Literal['cursor_state']
    focused_index: int | None = None
    selected_indices: list[int] = Field(default_factory=list)


@dataclass(slots=True)
class RequestSessionContext:
    room_id: str
    seat: SeatId
    seat_token: str


room_manager = RoomManager()
app = FastAPI(title='KCD2Gamble LAN API', version='0.5.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)
app.include_router(hotseat_router)

FRONTEND_DIST = ROOT / 'threejs-frontend' / 'dist'


def normalize_room_id(room_id: str | None) -> str:
    candidate = (room_id or DEFAULT_ROOM_ID).strip()
    return candidate or DEFAULT_ROOM_ID


def normalize_seat(seat: str) -> SeatId:
    candidate = seat.strip().upper()
    if candidate not in SEATS:
        raise HTTPException(status_code=400, detail='Seat must be A or B.')
    return candidate  # type: ignore[return-value]


def build_snapshot(room: Room) -> GameSnapshot:
    state = room.engine.state
    return GameSnapshot(
        target_score=state.target_score,
        current_player=state.current_player,
        scores=dict(state.scores),
        turn_points=state.turn_points,
        remaining_dice=state.remaining_dice,
        current_roll=list(state.current_roll),
        phase=state.phase.value,
        winner=state.winner,
        available_actions=AvailableActions(
            new_game=True,
            roll=state.phase.value == 'ready_to_roll',
            take_selection=state.phase.value == 'awaiting_selection',
            continue_turn=state.phase.value == 'can_bank_or_continue',
            bank_turn=state.phase.value == 'can_bank_or_continue' and state.turn_points > 0,
            resolve_farkle=state.phase.value == 'farkle',
        ),
    )


def build_room_state(room: Room) -> RoomState:
    return RoomState(**room.room_state_dict())


def build_action_response(
    room: Room,
    message: str,
    *,
    roll: RollPayload | None = None,
    preview: PreviewPayload | None = None,
    take_result: TakeResultPayload | None = None,
    turn_result: TurnResultPayload | None = None,
) -> GameActionResponse:
    return GameActionResponse(
        message=message,
        snapshot=build_snapshot(room),
        room=build_room_state(room),
        roll=roll,
        preview=preview,
        take_result=take_result,
        turn_result=turn_result,
    )


def build_room_snapshot_response(room: Room, message: str) -> RoomSnapshotResponse:
    return RoomSnapshotResponse(
        message=message,
        snapshot=build_snapshot(room),
        room=build_room_state(room),
    )


def build_room_event(
    room: Room,
    *,
    event_type: Literal['room_state', 'game_state', 'cursor_state'],
    message: str,
    actor_seat: SeatId | None = None,
) -> RoomEvent:
    return RoomEvent(
        type=event_type,
        message=message,
        snapshot=build_snapshot(room),
        room=build_room_state(room),
        actor_seat=actor_seat,
    )


def raise_game_error(exc: Exception) -> None:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


def normalize_cursor_indices(indices: list[int], die_count: int) -> list[int]:
    normalized = sorted({index for index in indices if 0 <= index < die_count})
    return normalized


def get_session_context(
    x_room_id: str = Header(default=DEFAULT_ROOM_ID, alias='X-Room-Id'),
    x_seat: str = Header(alias='X-Seat'),
    x_seat_token: str = Header(alias='X-Seat-Token'),
) -> RequestSessionContext:
    return RequestSessionContext(
        room_id=normalize_room_id(x_room_id),
        seat=normalize_seat(x_seat),
        seat_token=x_seat_token,
    )


def require_turn_owner(room: Room, context: RequestSessionContext) -> None:
    room.require_reservation(context.seat, context.seat_token)
    current_player = room.engine.state.current_player
    if current_player != context.seat:
        raise HTTPException(status_code=403, detail=f"It is player {current_player}'s turn.")


@app.get('/api/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.get('/api/room', response_model=RoomSnapshotResponse)
async def get_room(room_id: str = Query(default=DEFAULT_ROOM_ID)) -> RoomSnapshotResponse:
    room = await room_manager.get_room(normalize_room_id(room_id))
    async with room.lock:
        return build_room_snapshot_response(room, 'Loaded room state.')


@app.get('/api/game', response_model=RoomSnapshotResponse)
async def get_game(room_id: str = Query(default=DEFAULT_ROOM_ID)) -> RoomSnapshotResponse:
    room = await room_manager.get_room(normalize_room_id(room_id))
    async with room.lock:
        return build_room_snapshot_response(room, 'Loaded current game state.')


@app.post('/api/room/join', response_model=JoinRoomResponse)
async def join_room(payload: JoinRoomRequest) -> JoinRoomResponse:
    room = await room_manager.get_room(normalize_room_id(payload.room_id))

    try:
        async with room.lock:
            seat = normalize_seat(payload.seat)
            token = room.join_seat(seat, payload.seat_token)
            response = JoinRoomResponse(
                message=f'Joined seat {seat}.',
                session=SessionInfo(room_id=room.room_id, seat=seat, seat_token=token),
                snapshot=build_snapshot(room),
                room=build_room_state(room),
            )
            event = build_room_event(
                room,
                event_type='room_state',
                message=f'Player {seat} joined the room.',
                actor_seat=seat,
            )
    except SeatOccupiedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await room.broadcast(event.model_dump(mode='json'))
    return response


@app.post('/api/room/leave', response_model=RoomSnapshotResponse)
async def leave_room(payload: LeaveRoomRequest) -> RoomSnapshotResponse:
    room = await room_manager.get_room(normalize_room_id(payload.room_id))

    try:
        async with room.lock:
            seat = normalize_seat(payload.seat)
            room.release_seat(seat, payload.seat_token)
            response = build_room_snapshot_response(room, f'Released seat {seat}.')
            event = build_room_event(
                room,
                event_type='room_state',
                message=f'Player {seat} left the room.',
                actor_seat=seat,
            )
    except SeatTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    await room.broadcast(event.model_dump(mode='json'))
    return response


@app.post('/api/new-game', response_model=GameActionResponse)
async def new_game(
    payload: NewGameRequest,
    context: RequestSessionContext = Depends(get_session_context),
) -> GameActionResponse:
    room = await room_manager.get_room(context.room_id)

    try:
        async with room.lock:
            room.require_reservation(context.seat, context.seat_token)
            if context.seat != 'A':
                raise HTTPException(status_code=403, detail='Only player A can start a new game.')
            room.engine.reset(payload.target_score, seed=payload.seed)
            room.clear_all_cursor_states()
            response = build_action_response(room, 'Started a new game.')
            event = build_room_event(
                room,
                event_type='game_state',
                message='Started a new game.',
                actor_seat=context.seat,
            )
    except SeatTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    await room.broadcast(event.model_dump(mode='json'))
    return response


@app.post('/api/roll', response_model=GameActionResponse)
async def roll(context: RequestSessionContext = Depends(get_session_context)) -> GameActionResponse:
    room = await room_manager.get_room(context.room_id)

    try:
        async with room.lock:
            require_turn_owner(room, context)
            room.clear_cursor_state(context.seat)
            result = room.engine.roll()
            message = (
                f'Player {result.player} rolled {list(result.dice)}.'
                if result.has_scoring_option
                else f'Player {result.player} farkled with {list(result.dice)}.'
            )
            response = build_action_response(
                room,
                message,
                roll=RollPayload(
                    player=result.player,
                    dice=list(result.dice),
                    has_scoring_option=result.has_scoring_option,
                ),
            )
            event = build_room_event(room, event_type='game_state', message=message, actor_seat=context.seat)
    except SeatTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    await room.broadcast(event.model_dump(mode='json'))
    return response


@app.post('/api/preview-selection', response_model=GameActionResponse)
async def preview_selected_dice(
    payload: SelectionRequest,
    context: RequestSessionContext = Depends(get_session_context),
) -> GameActionResponse:
    room = await room_manager.get_room(context.room_id)

    try:
        async with room.lock:
            require_turn_owner(room, context)
            preview = room.engine.preview_selection(payload.indices)
            message = (
                f'Selection scores {preview.points} points.'
                if preview.is_valid
                else 'Selected dice do not form a valid scoring combination.'
            )
            return build_action_response(
                room,
                message,
                preview=PreviewPayload(
                    indices=list(preview.indices),
                    dice=list(preview.dice),
                    points=preview.points,
                    is_valid=preview.is_valid,
                ),
            )
    except SeatTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)


@app.post('/api/take-selection', response_model=GameActionResponse)
async def take_selected_dice(
    payload: SelectionRequest,
    context: RequestSessionContext = Depends(get_session_context),
) -> GameActionResponse:
    room = await room_manager.get_room(context.room_id)

    try:
        async with room.lock:
            require_turn_owner(room, context)
            room.clear_cursor_state(context.seat)
            result = room.engine.take_selection(payload.indices)
            message = (
                f'Player {result.player} took scoring dice for {result.points_gained} points.'
                if not result.hot_dice
                else f'Player {result.player} cleared the tray and triggered hot dice.'
            )
            response = build_action_response(
                room,
                message,
                take_result=TakeResultPayload(
                    player=result.player,
                    selected_dice=list(result.selected_dice),
                    points_gained=result.points_gained,
                    turn_points=result.turn_points,
                    remaining_dice=result.remaining_dice,
                    hot_dice=result.hot_dice,
                ),
            )
            event = build_room_event(room, event_type='game_state', message=message, actor_seat=context.seat)
    except SeatTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    await room.broadcast(event.model_dump(mode='json'))
    return response


@app.post('/api/continue-turn', response_model=GameActionResponse)
async def continue_turn(context: RequestSessionContext = Depends(get_session_context)) -> GameActionResponse:
    room = await room_manager.get_room(context.room_id)

    try:
        async with room.lock:
            require_turn_owner(room, context)
            room.clear_cursor_state(context.seat)
            result = room.engine.continue_turn()
            message = (
                f'Player {result.player} continued and rolled {list(result.dice)}.'
                if result.has_scoring_option
                else f'Player {result.player} continued and farkled with {list(result.dice)}.'
            )
            response = build_action_response(
                room,
                message,
                roll=RollPayload(
                    player=result.player,
                    dice=list(result.dice),
                    has_scoring_option=result.has_scoring_option,
                ),
            )
            event = build_room_event(room, event_type='game_state', message=message, actor_seat=context.seat)
    except SeatTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    await room.broadcast(event.model_dump(mode='json'))
    return response


@app.post('/api/bank-turn', response_model=GameActionResponse)
async def bank_turn(context: RequestSessionContext = Depends(get_session_context)) -> GameActionResponse:
    room = await room_manager.get_room(context.room_id)

    try:
        async with room.lock:
            require_turn_owner(room, context)
            room.clear_all_cursor_states()
            result = room.engine.bank_turn()
            message = (
                f'Player {result.player} won by banking to {result.total_score}.'
                if result.won
                else f'Player {result.player} banked {result.banked_points} points.'
            )
            response = build_action_response(
                room,
                message,
                turn_result=TurnResultPayload(
                    player=result.player,
                    banked_points=result.banked_points,
                    total_score=result.total_score,
                    next_player=result.next_player,
                    won=result.won,
                ),
            )
            event = build_room_event(room, event_type='game_state', message=message, actor_seat=context.seat)
    except SeatTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    await room.broadcast(event.model_dump(mode='json'))
    return response


@app.post('/api/resolve-farkle', response_model=GameActionResponse)
async def resolve_farkle(context: RequestSessionContext = Depends(get_session_context)) -> GameActionResponse:
    room = await room_manager.get_room(context.room_id)

    try:
        async with room.lock:
            require_turn_owner(room, context)
            room.clear_all_cursor_states()
            result = room.engine.finish_farkle_turn()
            message = f'Turn passes to player {result.next_player}.'
            response = build_action_response(
                room,
                message,
                turn_result=TurnResultPayload(
                    player=result.player,
                    banked_points=result.banked_points,
                    total_score=result.total_score,
                    next_player=result.next_player,
                    won=result.won,
                ),
            )
            event = build_room_event(room, event_type='game_state', message=message, actor_seat=context.seat)
    except SeatTokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    await room.broadcast(event.model_dump(mode='json'))
    return response


@app.websocket('/ws/rooms/{room_id}')
async def room_socket(
    websocket: WebSocket,
    room_id: str,
    seat: str | None = Query(default=None),
    seat_token: str | None = Query(default=None),
) -> None:
    room = await room_manager.get_room(normalize_room_id(room_id))
    normalized_seat = normalize_seat(seat) if seat is not None else None
    await websocket.accept()
    disconnect_event: RoomEvent | None = None

    try:
        async with room.lock:
            room.register_connection(websocket, normalized_seat, seat_token)
            initial_event = build_room_event(
                room,
                event_type='room_state',
                message='Connected to room.',
                actor_seat=normalized_seat,
            )
            presence_event = build_room_event(
                room,
                event_type='room_state',
                message=(
                    f'Player {normalized_seat} connected.' if normalized_seat is not None else 'Viewer connected.'
                ),
                actor_seat=normalized_seat,
            )
    except SeatTokenError as exc:
        await websocket.close(code=4403, reason=str(exc))
        return

    await websocket.send_json(initial_event.model_dump(mode='json'))
    await room.broadcast(presence_event.model_dump(mode='json'), exclude=websocket)

    try:
        while True:
            raw_message = await websocket.receive_text()

            try:
                message = CursorStateUpdateMessage.model_validate(json.loads(raw_message))
            except (json.JSONDecodeError, ValidationError):
                continue

            if normalized_seat is None or seat_token is None:
                continue

            async with room.lock:
                try:
                    room.require_reservation(normalized_seat, seat_token)
                except SeatTokenError:
                    break

                die_count = len(room.engine.state.current_roll)
                focused_index = (
                    message.focused_index
                    if message.focused_index is not None and 0 <= message.focused_index < die_count
                    else None
                )
                selected_indices = normalize_cursor_indices(message.selected_indices, die_count)

                if room.engine.state.current_player != normalized_seat or room.engine.state.phase.value != 'awaiting_selection':
                    room.clear_cursor_state(normalized_seat)
                else:
                    room.set_cursor_state(normalized_seat, focused_index, selected_indices)

                cursor_event = build_room_event(
                    room,
                    event_type='cursor_state',
                    message=f'Player {normalized_seat} updated the shared cursor.',
                    actor_seat=normalized_seat,
                )

            await room.broadcast(cursor_event.model_dump(mode='json'), exclude=websocket)
    except WebSocketDisconnect:
        pass
    finally:
        async with room.lock:
            meta = room.unregister_connection(websocket)
            if meta and meta.seat is not None:
                disconnect_event = build_room_event(
                    room,
                    event_type='room_state',
                    message=f'Player {meta.seat} disconnected.',
                    actor_seat=meta.seat,
                )

        if disconnect_event is not None:
            await room.broadcast(disconnect_event.model_dump(mode='json'), exclude=websocket)


if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / 'assets'
    if assets_dir.exists():
        app.mount('/assets', StaticFiles(directory=assets_dir), name='assets')

    @app.get('/', include_in_schema=False)
    async def serve_index() -> FileResponse:
        return FileResponse(FRONTEND_DIST / 'index.html')


    @app.get('/{full_path:path}', include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / 'index.html')
