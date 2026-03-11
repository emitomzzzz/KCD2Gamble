from .app import build_parser, main
from .cli import (
    choose_scoring_dice,
    choose_turn_action,
    format_roll,
    input_target_score,
    parse_indices,
    play_game,
    play_turn,
    print_rules,
    roll_dice,
)
from .constants import (
    DEFAULT_TARGET_SCORE,
    RULES,
    STRAIGHT_PATTERNS,
    THREE_OF_A_KIND_BASE_SCORES,
)
from .engine import DiceGameEngine, GamePhase, GameState, GameStateError
from .gui import launch_gui
from .scoring import (
    counts_key,
    has_scoring_option,
    score_counts,
    score_of_kind,
    score_selection,
)

__all__ = [
    "DEFAULT_TARGET_SCORE",
    "DiceGameEngine",
    "GamePhase",
    "GameState",
    "GameStateError",
    "RULES",
    "STRAIGHT_PATTERNS",
    "THREE_OF_A_KIND_BASE_SCORES",
    "build_parser",
    "choose_scoring_dice",
    "choose_turn_action",
    "counts_key",
    "format_roll",
    "has_scoring_option",
    "input_target_score",
    "launch_gui",
    "main",
    "parse_indices",
    "play_game",
    "play_turn",
    "print_rules",
    "roll_dice",
    "score_counts",
    "score_of_kind",
    "score_selection",
]
