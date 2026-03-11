import random

from .constants import RULES
from .scoring import has_scoring_option, score_selection


def format_roll(dice):
    return "  ".join(f"{index + 1}:{value}" for index, value in enumerate(dice))


def print_rules():
    print("计分规则:")
    for rule in RULES:
        print(f"  {rule}")
    print()


def roll_dice(remaining, rng):
    return [rng.randint(1, 6) for _ in range(remaining)]


def parse_indices(raw_text, max_index):
    parts = raw_text.split()
    if not parts:
        raise ValueError("至少要选择一颗骰子。")

    indices = []
    for part in parts:
        if not part.isdigit():
            raise ValueError("只能输入数字编号。")
        index = int(part)
        if index < 1 or index > max_index:
            raise ValueError("编号超出范围。")
        indices.append(index - 1)

    if len(set(indices)) != len(indices):
        raise ValueError("编号不能重复。")

    return sorted(indices)


def input_target_score(default_target):
    raw = input(f"请输入目标分数，直接回车使用默认值 {default_target}: ").strip()
    if not raw:
        return default_target
    if not raw.isdigit() or int(raw) <= 0:
        print("输入无效，使用默认目标分数。")
        return default_target
    return int(raw)


def choose_scoring_dice(roll):
    while True:
        raw = input("请选择要拿走并计分的骰子编号，用空格分隔: ").strip()
        try:
            indices = parse_indices(raw, len(roll))
        except ValueError as exc:
            print(f"输入无效: {exc}")
            continue

        selected = [roll[index] for index in indices]
        points = score_selection(selected)
        if points <= 0:
            print("这些骰子不能组成有效得分，请重新选择。")
            continue

        return indices, selected, points


def choose_turn_action():
    while True:
        raw = input("输入 r 继续掷骰，输入 b 把本回合分数记入总分: ").strip().lower()
        if raw in {"r", "b"}:
            return raw
        print("请输入 r 或 b。")


def play_turn(player_name, total_score, rng):
    remaining = 6
    turn_points = 0

    print(f"\n{player_name} 的回合，当前总分: {total_score}")

    while True:
        roll = roll_dice(remaining, rng)
        print(f"掷出 {remaining} 颗骰子: {format_roll(roll)}")

        if not has_scoring_option(roll):
            print("本次没有任何得分组合，本回合暂存分数作废。")
            return 0

        _, selected, gained = choose_scoring_dice(roll)
        turn_points += gained
        remaining -= len(selected)
        print(f"拿走 {selected}，获得 {gained} 分，回合暂存 {turn_points} 分。")

        if remaining == 0:
            remaining = 6
            print("所有骰子都已拿走，下一掷恢复为 6 颗骰子。")

        action = choose_turn_action()
        if action == "b":
            print(f"{player_name} 结束回合，{turn_points} 分计入总分。")
            return turn_points


def play_game(target_score, seed=None):
    rng = random.Random(seed)
    scores = {"A": 0, "B": 0}
    players = ["A", "B"]
    turn = 0

    print_rules()
    print(f"游戏开始，先达到 {target_score} 分的玩家获胜。")

    while True:
        player = players[turn % 2]
        gained = play_turn(player, scores[player], rng)
        scores[player] += gained
        print(f"当前比分: A = {scores['A']}，B = {scores['B']}")

        if scores[player] >= target_score:
            print(f"\n玩家 {player} 达到目标分数，获得胜利。")
            return player, scores

        turn += 1
