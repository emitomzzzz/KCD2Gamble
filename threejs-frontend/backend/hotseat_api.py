from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from dicegame.constants import DEFAULT_TARGET_SCORE
from dicegame.engine import GameStateError
from .hotseat_manager import HotseatManager, HotseatSession, HotseatSessionNotFoundError
from .room_manager import SEATS, SeatId

router = APIRouter(prefix='/api/hotseat', tags=['hotseat'])
hotseat_manager = HotseatManager()


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


class HotseatSessionInfo(BaseModel):
    session_token: str


class HotseatSnapshotResponse(BaseModel):
    message: str
    session: HotseatSessionInfo
    snapshot: GameSnapshot
    room: RoomState


class HotseatStartRequest(BaseModel):
    target_score: int = Field(default=DEFAULT_TARGET_SCORE, gt=0)
    seed: int | None = None


class SelectionRequest(BaseModel):
    indices: list[int] = Field(min_length=1)


@dataclass(slots=True)
class HotseatSessionContext:
    session_token: str


def build_snapshot(session: HotseatSession) -> GameSnapshot:
    state = session.engine.state
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


def build_room_state(session: HotseatSession) -> RoomState:
    return RoomState(**session.room_state_dict())


def build_action_response(
    session: HotseatSession,
    message: str,
    *,
    roll: RollPayload | None = None,
    preview: PreviewPayload | None = None,
    take_result: TakeResultPayload | None = None,
    turn_result: TurnResultPayload | None = None,
) -> GameActionResponse:
    return GameActionResponse(
        message=message,
        snapshot=build_snapshot(session),
        room=build_room_state(session),
        roll=roll,
        preview=preview,
        take_result=take_result,
        turn_result=turn_result,
    )


def build_hotseat_snapshot_response(session: HotseatSession, message: str) -> HotseatSnapshotResponse:
    return HotseatSnapshotResponse(
        message=message,
        session=HotseatSessionInfo(session_token=session.token),
        snapshot=build_snapshot(session),
        room=build_room_state(session),
    )


def raise_game_error(exc: Exception) -> None:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


def get_hotseat_context(x_hotseat_token: str = Header(alias='X-Hotseat-Token')) -> HotseatSessionContext:
    return HotseatSessionContext(session_token=x_hotseat_token)


async def require_hotseat_session(context: HotseatSessionContext) -> HotseatSession:
    try:
        return await hotseat_manager.get_session(context.session_token)
    except HotseatSessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/state', response_model=HotseatSnapshotResponse)
async def get_hotseat_state(context: HotseatSessionContext = Depends(get_hotseat_context)) -> HotseatSnapshotResponse:
    session = await require_hotseat_session(context)
    async with session.lock:
        session.touch()
        return build_hotseat_snapshot_response(session, 'Loaded hotseat game state.')


@router.post('/start', response_model=HotseatSnapshotResponse)
async def start_hotseat_game(
    payload: HotseatStartRequest,
    x_hotseat_token: str | None = Header(default=None, alias='X-Hotseat-Token'),
) -> HotseatSnapshotResponse:
    session = await hotseat_manager.create_or_restore(x_hotseat_token)
    async with session.lock:
        session.engine.reset(payload.target_score, seed=payload.seed)
        session.clear_all_cursor_states()
        session.touch()
        return build_hotseat_snapshot_response(session, 'Started a hotseat game.')


@router.post('/release')
async def release_hotseat_game(context: HotseatSessionContext = Depends(get_hotseat_context)) -> dict[str, str]:
    await hotseat_manager.release_session(context.session_token)
    return {'status': 'released'}


@router.post('/roll', response_model=GameActionResponse)
async def hotseat_roll(context: HotseatSessionContext = Depends(get_hotseat_context)) -> GameActionResponse:
    session = await require_hotseat_session(context)
    try:
        async with session.lock:
            session.clear_cursor_state(session.engine.state.current_player)
            result = session.engine.roll()
            session.touch()
            message = (
                f'Player {result.player} rolled {list(result.dice)}.'
                if result.has_scoring_option
                else f'Player {result.player} farkled with {list(result.dice)}.'
            )
            return build_action_response(
                session,
                message,
                roll=RollPayload(
                    player=result.player,
                    dice=list(result.dice),
                    has_scoring_option=result.has_scoring_option,
                ),
            )
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)


@router.post('/preview-selection', response_model=GameActionResponse)
async def hotseat_preview_selection(
    payload: SelectionRequest,
    context: HotseatSessionContext = Depends(get_hotseat_context),
) -> GameActionResponse:
    session = await require_hotseat_session(context)
    try:
        async with session.lock:
            preview = session.engine.preview_selection(payload.indices)
            session.touch()
            message = (
                f'Selection scores {preview.points} points.'
                if preview.is_valid
                else 'Selected dice do not form a valid scoring combination.'
            )
            return build_action_response(
                session,
                message,
                preview=PreviewPayload(
                    indices=list(preview.indices),
                    dice=list(preview.dice),
                    points=preview.points,
                    is_valid=preview.is_valid,
                ),
            )
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)


@router.post('/take-selection', response_model=GameActionResponse)
async def hotseat_take_selection(
    payload: SelectionRequest,
    context: HotseatSessionContext = Depends(get_hotseat_context),
) -> GameActionResponse:
    session = await require_hotseat_session(context)
    try:
        async with session.lock:
            session.clear_cursor_state(session.engine.state.current_player)
            result = session.engine.take_selection(payload.indices)
            session.touch()
            message = (
                f'Player {result.player} took scoring dice for {result.points_gained} points.'
                if not result.hot_dice
                else f'Player {result.player} cleared the tray and triggered hot dice.'
            )
            return build_action_response(
                session,
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
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)


@router.post('/continue-turn', response_model=GameActionResponse)
async def hotseat_continue_turn(context: HotseatSessionContext = Depends(get_hotseat_context)) -> GameActionResponse:
    session = await require_hotseat_session(context)
    try:
        async with session.lock:
            session.clear_cursor_state(session.engine.state.current_player)
            result = session.engine.continue_turn()
            session.touch()
            message = (
                f'Player {result.player} continued and rolled {list(result.dice)}.'
                if result.has_scoring_option
                else f'Player {result.player} continued and farkled with {list(result.dice)}.'
            )
            return build_action_response(
                session,
                message,
                roll=RollPayload(
                    player=result.player,
                    dice=list(result.dice),
                    has_scoring_option=result.has_scoring_option,
                ),
            )
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)


@router.post('/bank-turn', response_model=GameActionResponse)
async def hotseat_bank_turn(context: HotseatSessionContext = Depends(get_hotseat_context)) -> GameActionResponse:
    session = await require_hotseat_session(context)
    try:
        async with session.lock:
            session.clear_all_cursor_states()
            result = session.engine.bank_turn()
            session.touch()
            message = (
                f'Player {result.player} won by banking to {result.total_score}.'
                if result.won
                else f'Player {result.player} banked {result.banked_points} points.'
            )
            return build_action_response(
                session,
                message,
                turn_result=TurnResultPayload(
                    player=result.player,
                    banked_points=result.banked_points,
                    total_score=result.total_score,
                    next_player=result.next_player,
                    won=result.won,
                ),
            )
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)


@router.post('/resolve-farkle', response_model=GameActionResponse)
async def hotseat_resolve_farkle(context: HotseatSessionContext = Depends(get_hotseat_context)) -> GameActionResponse:
    session = await require_hotseat_session(context)
    try:
        async with session.lock:
            session.clear_all_cursor_states()
            result = session.engine.finish_farkle_turn()
            session.touch()
            message = f'Turn passes to player {result.next_player}.'
            return build_action_response(
                session,
                message,
                turn_result=TurnResultPayload(
                    player=result.player,
                    banked_points=result.banked_points,
                    total_score=result.total_score,
                    next_player=result.next_player,
                    won=result.won,
                ),
            )
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)
