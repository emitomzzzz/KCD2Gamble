from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable

from .constants import DEFAULT_TARGET_SCORE
from .scoring import has_scoring_option, score_selection


class GamePhase(Enum):
    READY_TO_ROLL = "ready_to_roll"
    AWAITING_SELECTION = "awaiting_selection"
    CAN_BANK_OR_CONTINUE = "can_bank_or_continue"
    FARKLE = "farkle"
    GAME_OVER = "game_over"


class GameStateError(RuntimeError):
    pass


@dataclass
class GameState:
    target_score: int
    current_player: str
    scores: dict[str, int]
    turn_points: int = 0
    remaining_dice: int = 6
    current_roll: tuple[int, ...] = field(default_factory=tuple)
    phase: GamePhase = GamePhase.READY_TO_ROLL
    winner: str | None = None


@dataclass(frozen=True)
class RollResult:
    player: str
    dice: tuple[int, ...]
    has_scoring_option: bool


@dataclass(frozen=True)
class SelectionPreview:
    indices: tuple[int, ...]
    dice: tuple[int, ...]
    points: int

    @property
    def is_valid(self) -> bool:
        return self.points > 0


@dataclass(frozen=True)
class TakeSelectionResult:
    player: str
    selected_dice: tuple[int, ...]
    points_gained: int
    turn_points: int
    remaining_dice: int
    hot_dice: bool


@dataclass(frozen=True)
class TurnResult:
    player: str
    banked_points: int
    total_score: int
    next_player: str | None
    won: bool


def format_roll(dice):
    return "  ".join(f"{index + 1}:{value}" for index, value in enumerate(dice))


def roll_dice(remaining, rng):
    return tuple(rng.randint(1, 6) for _ in range(remaining))


def normalize_selection_indices(indices: Iterable[int], max_index: int) -> tuple[int, ...]:
    normalized = tuple(sorted(indices))
    if not normalized:
        raise ValueError("At least one die must be selected.")

    for index in normalized:
        if index < 0 or index >= max_index:
            raise ValueError("Die index out of range.")

    if len(set(normalized)) != len(normalized):
        raise ValueError("Die indices cannot be duplicated.")

    return normalized


class DiceGameEngine:
    def __init__(self, target_score=DEFAULT_TARGET_SCORE, seed=None, rng=None, players=("A", "B")):
        self.players = tuple(players)
        if not self.players:
            raise ValueError("At least one player is required.")
        if len(set(self.players)) != len(self.players):
            raise ValueError("Player names must be unique.")

        self.rng = rng if rng is not None else random.Random(seed)
        self.state = self._build_state(target_score)

    def reset(self, target_score, seed=None, rng=None):
        self.rng = rng if rng is not None else random.Random(seed)
        self.state = self._build_state(target_score)

    def roll(self) -> RollResult:
        self._require_phase(GamePhase.READY_TO_ROLL)
        dice = roll_dice(self.state.remaining_dice, self.rng)
        has_option = has_scoring_option(dice)
        self.state.current_roll = dice
        self.state.phase = GamePhase.AWAITING_SELECTION if has_option else GamePhase.FARKLE
        return RollResult(player=self.state.current_player, dice=dice, has_scoring_option=has_option)

    def preview_selection(self, indices: Iterable[int]) -> SelectionPreview:
        self._require_phase(GamePhase.AWAITING_SELECTION)
        normalized = normalize_selection_indices(indices, len(self.state.current_roll))
        dice = tuple(self.state.current_roll[index] for index in normalized)
        return SelectionPreview(indices=normalized, dice=dice, points=score_selection(dice))

    def take_selection(self, indices: Iterable[int]) -> TakeSelectionResult:
        preview = self.preview_selection(indices)
        if not preview.is_valid:
            raise ValueError("Selected dice do not form a valid scoring combination.")

        self.state.turn_points += preview.points
        self.state.remaining_dice -= len(preview.dice)
        hot_dice = False
        if self.state.remaining_dice == 0:
            self.state.remaining_dice = 6
            hot_dice = True

        self.state.current_roll = ()
        self.state.phase = GamePhase.CAN_BANK_OR_CONTINUE
        return TakeSelectionResult(
            player=self.state.current_player,
            selected_dice=preview.dice,
            points_gained=preview.points,
            turn_points=self.state.turn_points,
            remaining_dice=self.state.remaining_dice,
            hot_dice=hot_dice,
        )

    def continue_turn(self) -> RollResult:
        self._require_phase(GamePhase.CAN_BANK_OR_CONTINUE)
        self.state.phase = GamePhase.READY_TO_ROLL
        return self.roll()

    def bank_turn(self) -> TurnResult:
        self._require_phase(GamePhase.CAN_BANK_OR_CONTINUE)
        if self.state.turn_points <= 0:
            raise GameStateError("Cannot bank a turn with no points.")

        player = self.state.current_player
        self.state.scores[player] += self.state.turn_points
        total_score = self.state.scores[player]
        banked_points = self.state.turn_points

        if total_score >= self.state.target_score:
            self.state.winner = player
            self.state.current_roll = ()
            self.state.phase = GamePhase.GAME_OVER
            return TurnResult(
                player=player,
                banked_points=banked_points,
                total_score=total_score,
                next_player=None,
                won=True,
            )

        next_player = self._advance_turn()
        return TurnResult(
            player=player,
            banked_points=banked_points,
            total_score=total_score,
            next_player=next_player,
            won=False,
        )

    def finish_farkle_turn(self) -> TurnResult:
        self._require_phase(GamePhase.FARKLE)
        player = self.state.current_player
        total_score = self.state.scores[player]
        next_player = self._advance_turn()
        return TurnResult(
            player=player,
            banked_points=0,
            total_score=total_score,
            next_player=next_player,
            won=False,
        )

    def _build_state(self, target_score):
        if target_score <= 0:
            raise ValueError("Target score must be a positive integer.")

        return GameState(
            target_score=target_score,
            current_player=self.players[0],
            scores={player: 0 for player in self.players},
        )

    def _advance_turn(self):
        current_index = self.players.index(self.state.current_player)
        next_player = self.players[(current_index + 1) % len(self.players)]
        self.state.current_player = next_player
        self.state.turn_points = 0
        self.state.remaining_dice = 6
        self.state.current_roll = ()
        self.state.phase = GamePhase.READY_TO_ROLL
        return next_player

    def _require_phase(self, expected_phase):
        if self.state.phase != expected_phase:
            raise GameStateError(f"Expected phase {expected_phase.value}, got {self.state.phase.value}.")
