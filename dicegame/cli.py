from .constants import DEFAULT_TARGET_SCORE, RULES
from .engine import DiceGameEngine, format_roll as engine_format_roll, roll_dice as engine_roll_dice
from .scoring import score_selection


def format_roll(dice):
    return engine_format_roll(dice)


def print_rules():
    print("计分规则:")
    for rule in RULES:
        print(f"  {rule}")
    print()


def roll_dice(remaining, rng):
    return list(engine_roll_dice(remaining, rng))


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


def _play_cli_turn(engine, player_name, total_score):
    print(f"\n{player_name} 的回合，当前总分: {total_score}")
    roll_result = engine.roll()

    while True:
        print(f"掷出 {len(roll_result.dice)} 颗骰子: {format_roll(roll_result.dice)}")

        if not roll_result.has_scoring_option:
            print("本次没有任何得分组合，本回合暂存分数作废。")
            engine.finish_farkle_turn()
            return 0

        indices, selected, _ = choose_scoring_dice(roll_result.dice)
        take_result = engine.take_selection(indices)
        print(f"拿走 {selected}，获得 {take_result.points_gained} 分，回合暂存 {take_result.turn_points} 分。")

        if take_result.hot_dice:
            print("所有骰子都已拿走，下一掷恢复为 6 颗骰子。")

        action = choose_turn_action()
        if action == "b":
            bank_result = engine.bank_turn()
            print(f"{player_name} 结束回合，{bank_result.banked_points} 分计入总分。")
            return bank_result.banked_points

        roll_result = engine.continue_turn()


def play_turn(player_name, total_score, rng):
    engine = DiceGameEngine(
        target_score=DEFAULT_TARGET_SCORE,
        rng=rng,
        players=(player_name, f"{player_name}_other"),
    )
    return _play_cli_turn(engine, player_name, total_score)


def play_game(target_score, seed=None):
    engine = DiceGameEngine(target_score=target_score, seed=seed)

    print_rules()
    print(f"游戏开始，先达到 {target_score} 分的玩家获胜。")

    while engine.state.winner is None:
        player = engine.state.current_player
        _play_cli_turn(engine, player, engine.state.scores[player])
        print(f"当前比分: A = {engine.state.scores['A']}，B = {engine.state.scores['B']}")

    print(f"\n玩家 {engine.state.winner} 达到目标分数，获得胜利。")
    return engine.state.winner, dict(engine.state.scores)
