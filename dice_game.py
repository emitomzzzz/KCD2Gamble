import argparse
import random
from functools import lru_cache


def counts_key(dice):
    counts = [0] * 6
    for value in dice:
        if value < 1 or value > 6:
            raise ValueError("Dice values must be between 1 and 6.")
        counts[value - 1] += 1
    return tuple(counts)


def score_of_kind(face, count):
    base = 1000 if face == 1 else face * 100
    if count == 3:
        return base
    if count == 4:
        return base * 2
    if count == 5:
        return base * 3
    if count == 6:
        return base * 4
    raise ValueError("Only 3-6 of a kind are supported.")


@lru_cache(maxsize=None)
def score_counts(counts):
    total_dice = sum(counts)
    if total_dice == 0:
        return 0

    best = -1

    if total_dice == 6:
        if counts == (1, 1, 1, 1, 1, 1):
            best = max(best, 1500)
        if sum(1 for count in counts if count == 2) == 3:
            best = max(best, 1500)
        nonzero = sorted(count for count in counts if count)
        if nonzero == [3, 3]:
            best = max(best, 2500)
        if nonzero == [2, 4]:
            best = max(best, 1500)

    for face in range(1, 7):
        current = counts[face - 1]
        if current >= 3:
            for kind_size in range(3, current + 1):
                next_counts = list(counts)
                next_counts[face - 1] -= kind_size
                remainder = score_counts(tuple(next_counts))
                if sum(next_counts) == 0 or remainder >= 0:
                    best = max(best, score_of_kind(face, kind_size) + max(remainder, 0))

    for face, single_score in ((1, 100), (5, 50)):
        current = counts[face - 1]
        if current >= 1:
            next_counts = list(counts)
            next_counts[face - 1] -= 1
            remainder = score_counts(tuple(next_counts))
            if sum(next_counts) == 0 or remainder >= 0:
                best = max(best, single_score + max(remainder, 0))

    return best


def score_selection(dice):
    if not dice:
        return 0
    return max(score_counts(counts_key(tuple(dice))), 0)


def has_scoring_option(dice):
    length = len(dice)
    for mask in range(1, 1 << length):
        subset = [dice[index] for index in range(length) if mask & (1 << index)]
        if score_selection(subset) > 0:
            return True
    return False


def format_roll(dice):
    return "  ".join(f"{index + 1}:{value}" for index, value in enumerate(dice))


def parse_indices(raw_text, max_index):
    parts = raw_text.split()
    if not parts:
        raise ValueError("至少要选择一个骰子。")

    indices = []
    for part in parts:
        if not part.isdigit():
            raise ValueError("只能输入编号。")
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
        raw = input("输入 r 继续投掷，输入 b 计入总分并结束回合: ").strip().lower()
        if raw in {"r", "b"}:
            return raw
        print("请输入 r 或 b。")


def roll_dice(count, rng):
    return [rng.randint(1, 6) for _ in range(count)]


def print_rules():
    print("计分规则:")
    print("  单个 1 = 100 分")
    print("  单个 5 = 50 分")
    print("  三个相同点数: 1 为 1000 分，2-6 为点数 x 100")
    print("  四/五/六个相同点数: 分别是三连分数的 2/3/4 倍")
    print("  顺子 1-6 = 1500 分")
    print("  三对 = 1500 分")
    print("  两组三连 = 2500 分")
    print("  四个相同点数加一对 = 1500 分")
    print()


def play_turn(player_name, total_score, rng):
    remaining = 6
    turn_points = 0

    print(f"\n{player_name} 的回合，当前总分: {total_score}")

    while True:
        roll = roll_dice(remaining, rng)
        print(f"掷出了 {remaining} 颗骰子: {format_roll(roll)}")

        if not has_scoring_option(roll):
            print("本次投掷没有任何得分组合，本回合得分作废。")
            return 0

        _, selected, gained = choose_scoring_dice(roll)
        turn_points += gained
        remaining -= len(selected)
        print(f"拿走 {selected}，本次获得 {gained} 分，回合暂存 {turn_points} 分。")

        if remaining == 0:
            remaining = 6
            print("所有骰子都已拿走，下次可以重新投掷 6 颗骰子。")

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


def build_parser():
    parser = argparse.ArgumentParser(description="双人六骰子回合制游戏")
    parser.add_argument(
        "--target",
        type=int,
        default=None,
        help="目标分数，未提供时默认 5000",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="随机种子，便于复现对局",
    )
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.target is None:
        target = input_target_score(5000)
    else:
        target = args.target if args.target > 0 else 5000

    try:
        play_game(target, seed=args.seed)
    except KeyboardInterrupt:
        print("\n游戏已中断。")


if __name__ == "__main__":
    main()
