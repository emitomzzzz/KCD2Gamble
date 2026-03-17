from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dicegame.constants import DEFAULT_TARGET_SCORE
from dicegame.engine import DiceGameEngine, GameStateError


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
    roll: RollPayload | None = None
    preview: PreviewPayload | None = None
    take_result: TakeResultPayload | None = None
    turn_result: TurnResultPayload | None = None


class NewGameRequest(BaseModel):
    target_score: int = Field(default=DEFAULT_TARGET_SCORE, gt=0)
    seed: int | None = None


class SelectionRequest(BaseModel):
    indices: list[int] = Field(min_length=1)


class GameSession:
    def __init__(self) -> None:
        self.engine = DiceGameEngine(target_score=DEFAULT_TARGET_SCORE)

    def snapshot(self) -> GameSnapshot:
        state = self.engine.state
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


session = GameSession()
app = FastAPI(title='KCD2Gamble Phase Five API', version='0.4.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://127.0.0.1:5173', 'http://localhost:5173'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)


def raise_game_error(exc: Exception) -> None:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get('/api/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.get('/api/game', response_model=GameActionResponse)
def get_game() -> GameActionResponse:
    return GameActionResponse(
        message='Loaded current game state.',
        snapshot=session.snapshot(),
    )


@app.post('/api/new-game', response_model=GameActionResponse)
def new_game(payload: NewGameRequest) -> GameActionResponse:
    session.engine.reset(payload.target_score, seed=payload.seed)
    return GameActionResponse(
        message='Started a new game.',
        snapshot=session.snapshot(),
    )


@app.post('/api/roll', response_model=GameActionResponse)
def roll() -> GameActionResponse:
    try:
        result = session.engine.roll()
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    message = (
        f'Player {result.player} rolled {list(result.dice)}.'
        if result.has_scoring_option
        else f'Player {result.player} farkled with {list(result.dice)}.'
    )
    return GameActionResponse(
        message=message,
        snapshot=session.snapshot(),
        roll=RollPayload(
            player=result.player,
            dice=list(result.dice),
            has_scoring_option=result.has_scoring_option,
        ),
    )


@app.post('/api/preview-selection', response_model=GameActionResponse)
def preview_selected_dice(payload: SelectionRequest) -> GameActionResponse:
    try:
        preview = session.engine.preview_selection(payload.indices)
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    message = (
        f'Selection scores {preview.points} points.'
        if preview.is_valid
        else 'Selected dice do not form a valid scoring combination.'
    )
    return GameActionResponse(
        message=message,
        snapshot=session.snapshot(),
        preview=PreviewPayload(
            indices=list(preview.indices),
            dice=list(preview.dice),
            points=preview.points,
            is_valid=preview.is_valid,
        ),
    )


@app.post('/api/take-selection', response_model=GameActionResponse)
def take_selected_dice(payload: SelectionRequest) -> GameActionResponse:
    try:
        result = session.engine.take_selection(payload.indices)
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    message = (
        f'Player {result.player} took scoring dice for {result.points_gained} points.'
        if not result.hot_dice
        else f'Player {result.player} cleared the tray and triggered hot dice.'
    )
    return GameActionResponse(
        message=message,
        snapshot=session.snapshot(),
        take_result=TakeResultPayload(
            player=result.player,
            selected_dice=list(result.selected_dice),
            points_gained=result.points_gained,
            turn_points=result.turn_points,
            remaining_dice=result.remaining_dice,
            hot_dice=result.hot_dice,
        ),
    )


@app.post('/api/continue-turn', response_model=GameActionResponse)
def continue_turn() -> GameActionResponse:
    try:
        result = session.engine.continue_turn()
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    message = (
        f'Player {result.player} continued and rolled {list(result.dice)}.'
        if result.has_scoring_option
        else f'Player {result.player} continued and farkled with {list(result.dice)}.'
    )
    return GameActionResponse(
        message=message,
        snapshot=session.snapshot(),
        roll=RollPayload(
            player=result.player,
            dice=list(result.dice),
            has_scoring_option=result.has_scoring_option,
        ),
    )


@app.post('/api/bank-turn', response_model=GameActionResponse)
def bank_turn() -> GameActionResponse:
    try:
        result = session.engine.bank_turn()
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    message = (
        f'Player {result.player} won by banking to {result.total_score}.'
        if result.won
        else f'Player {result.player} banked {result.banked_points} points.'
    )
    return GameActionResponse(
        message=message,
        snapshot=session.snapshot(),
        turn_result=TurnResultPayload(
            player=result.player,
            banked_points=result.banked_points,
            total_score=result.total_score,
            next_player=result.next_player,
            won=result.won,
        ),
    )


@app.post('/api/resolve-farkle', response_model=GameActionResponse)
def resolve_farkle() -> GameActionResponse:
    try:
        result = session.engine.finish_farkle_turn()
    except (GameStateError, ValueError) as exc:
        raise_game_error(exc)

    return GameActionResponse(
        message=f'Turn passes to player {result.next_player}.',
        snapshot=session.snapshot(),
        turn_result=TurnResultPayload(
            player=result.player,
            banked_points=result.banked_points,
            total_score=result.total_score,
            next_player=result.next_player,
            won=result.won,
        ),
    )
