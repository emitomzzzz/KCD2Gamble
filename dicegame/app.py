import argparse
import sys

from .cli import input_target_score, play_game
from .constants import DEFAULT_TARGET_SCORE
from .gui import launch_gui


def build_parser():
    parser = argparse.ArgumentParser(description="双人六骰子回合制游戏")
    parser.add_argument(
        "--target",
        type=int,
        default=None,
        help=f"目标分数，未提供时默认为 {DEFAULT_TARGET_SCORE}",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="随机种子，便于复现对局",
    )
    parser.add_argument(
        "--gui",
        action="store_true",
        help="启动图形界面",
    )
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.gui:
        target = args.target if args.target and args.target > 0 else DEFAULT_TARGET_SCORE
        launch_gui(target_score=target, seed=args.seed)
        return

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    if args.target is None:
        target = input_target_score(DEFAULT_TARGET_SCORE)
    else:
        target = args.target if args.target > 0 else DEFAULT_TARGET_SCORE

    try:
        play_game(target, seed=args.seed)
    except KeyboardInterrupt:
        print("\n游戏已中断。")
