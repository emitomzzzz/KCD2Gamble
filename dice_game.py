import argparse
import random
import sys
from functools import lru_cache


DEFAULT_TARGET_SCORE = 5000
RULES = [
    "单个 1 = 100 分",
    "单个 5 = 50 分",
    "三个相同点数：1 为 1000 分，2-6 为点数 x 100",
    "四、五、六个相同点数：分别是三连分数的 2 / 3 / 4 倍",
    "顺子 1-6 = 1500 分",
    "三对 = 1500 分",
    "两组三连 = 2500 分",
    "四个相同点数加一对 = 1500 分",
]


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


def print_rules():
    print("计分规则：")
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
            print("本次掷骰没有任何得分组合，本回合得分作废。")
            return 0

        _, selected, gained = choose_scoring_dice(roll)
        turn_points += gained
        remaining -= len(selected)
        print(f"拿走 {selected}，本次获得 {gained} 分，回合暂存 {turn_points} 分。")

        if remaining == 0:
            remaining = 6
            print("所有骰子都已拿走，下次可以重新掷 6 颗骰子。")

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


def launch_gui(target_score=DEFAULT_TARGET_SCORE, seed=None):
    try:
        import tkinter as tk
        from tkinter import messagebox
    except ImportError as exc:
        raise RuntimeError("当前 Python 环境不支持 tkinter，无法启动图形界面。") from exc

    class DiceGameGUI:
        BG = "#efe5d2"
        PANEL = "#fbf7ee"
        PANEL_ALT = "#f4ecdd"
        ACCENT = "#8b5e34"
        ACCENT_LIGHT = "#dcbf8a"
        TEXT = "#2e2418"
        MUTED = "#6b5a49"
        SUCCESS = "#3c6e47"
        DANGER = "#9b4d36"

        def __init__(self, master, initial_target, initial_seed):
            self.root = master
            self.root.title("骰子博弈")
            self.root.configure(bg=self.BG)
            self.root.minsize(1180, 760)
            self.root.option_add("*Font", ("Microsoft YaHei UI", 10))

            self.target_var = tk.StringVar(value=str(initial_target))
            self.seed_var = tk.StringVar(value="" if initial_seed is None else str(initial_seed))
            self.status_var = tk.StringVar()
            self.turn_points_var = tk.StringVar()
            self.remaining_var = tk.StringVar()
            self.selection_var = tk.StringVar()
            self.score_vars = {"A": tk.StringVar(value="0"), "B": tk.StringVar(value="0")}

            self.target_score = initial_target
            self.current_player = "A"
            self.scores = {"A": 0, "B": 0}
            self.turn_points = 0
            self.remaining_dice = 6
            self.current_roll = []
            self.selected_indices = set()
            self.game_over = False
            self.awaiting_selection = False
            self.rng = random.Random(initial_seed)

            self.player_cards = {}
            self.dice_container = None
            self.selection_label = None
            self.log_text = None
            self.roll_button = None
            self.take_button = None
            self.continue_button = None
            self.bank_button = None

            self.build_layout()
            self.start_new_game()

        def build_layout(self):
            header = tk.Frame(self.root, bg=self.BG)
            header.pack(fill="x", padx=24, pady=(20, 12))

            title = tk.Label(
                header,
                text="骰子博弈",
                bg=self.BG,
                fg=self.TEXT,
                font=("Microsoft YaHei UI", 24, "bold"),
            )
            title.pack(anchor="w")

            subtitle = tk.Label(
                header,
                text="保留原有计分规则，改成可视化回合操作。",
                bg=self.BG,
                fg=self.MUTED,
                font=("Microsoft YaHei UI", 11),
            )
            subtitle.pack(anchor="w", pady=(4, 0))

            controls = tk.Frame(self.root, bg=self.PANEL, bd=0, highlightthickness=1, highlightbackground="#dcc8a5")
            controls.pack(fill="x", padx=24, pady=(0, 16))

            tk.Label(
                controls,
                text="目标分数",
                bg=self.PANEL,
                fg=self.TEXT,
                font=("Microsoft YaHei UI", 10, "bold"),
            ).grid(row=0, column=0, padx=(18, 8), pady=16, sticky="w")
            tk.Entry(
                controls,
                textvariable=self.target_var,
                width=10,
                relief="flat",
                bd=0,
                highlightthickness=1,
                highlightbackground="#cab38d",
            ).grid(row=0, column=1, padx=(0, 16), pady=16, sticky="w")

            tk.Label(
                controls,
                text="随机种子",
                bg=self.PANEL,
                fg=self.TEXT,
                font=("Microsoft YaHei UI", 10, "bold"),
            ).grid(row=0, column=2, padx=(0, 8), pady=16, sticky="w")
            tk.Entry(
                controls,
                textvariable=self.seed_var,
                width=12,
                relief="flat",
                bd=0,
                highlightthickness=1,
                highlightbackground="#cab38d",
            ).grid(row=0, column=3, padx=(0, 16), pady=16, sticky="w")

            new_game_button = tk.Button(
                controls,
                text="开始新游戏",
                command=self.start_new_game,
                bg=self.ACCENT,
                fg="white",
                activebackground="#754d2b",
                activeforeground="white",
                relief="flat",
                padx=18,
                pady=8,
                cursor="hand2",
            )
            new_game_button.grid(row=0, column=4, padx=(0, 18), pady=16, sticky="w")

            controls.grid_columnconfigure(5, weight=1)

            main = tk.Frame(self.root, bg=self.BG)
            main.pack(fill="both", expand=True, padx=24, pady=(0, 24))
            main.grid_columnconfigure(0, weight=3)
            main.grid_columnconfigure(1, weight=2)
            main.grid_rowconfigure(0, weight=1)

            left = tk.Frame(main, bg=self.BG)
            left.grid(row=0, column=0, sticky="nsew", padx=(0, 16))
            left.grid_rowconfigure(2, weight=1)
            left.grid_columnconfigure(0, weight=1)

            right = tk.Frame(main, bg=self.BG)
            right.grid(row=0, column=1, sticky="nsew")
            right.grid_rowconfigure(0, weight=3)
            right.grid_rowconfigure(1, weight=2)
            right.grid_columnconfigure(0, weight=1)

            self.build_scoreboard(left)
            self.build_actions(left)
            self.build_dice_area(left)
            self.build_log_panel(right)
            self.build_rules_panel(right)

        def build_scoreboard(self, parent):
            panel = tk.Frame(parent, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5")
            panel.grid(row=0, column=0, sticky="ew", pady=(0, 16))
            panel.grid_columnconfigure(0, weight=1)
            panel.grid_columnconfigure(1, weight=1)
            panel.grid_columnconfigure(2, weight=1)

            for column, player in enumerate(("A", "B")):
                card = tk.Frame(panel, bg=self.PANEL_ALT, highlightthickness=2, highlightbackground="#d7c19c")
                card.grid(row=0, column=column, padx=14, pady=14, sticky="nsew")
                name = tk.Label(
                    card,
                    text=f"玩家 {player}",
                    bg=self.PANEL_ALT,
                    fg=self.TEXT,
                    font=("Microsoft YaHei UI", 11, "bold"),
                )
                name.pack(anchor="w", padx=14, pady=(14, 6))
                score = tk.Label(
                    card,
                    textvariable=self.score_vars[player],
                    bg=self.PANEL_ALT,
                    fg=self.TEXT,
                    font=("Microsoft YaHei UI", 24, "bold"),
                )
                score.pack(anchor="w", padx=14, pady=(0, 14))
                self.player_cards[player] = {"frame": card, "name": name, "score": score}

            summary = tk.Frame(panel, bg=self.PANEL)
            summary.grid(row=0, column=2, padx=14, pady=14, sticky="nsew")

            tk.Label(
                summary,
                text="当前回合",
                bg=self.PANEL,
                fg=self.MUTED,
                font=("Microsoft YaHei UI", 10, "bold"),
            ).pack(anchor="w")
            tk.Label(
                summary,
                textvariable=self.status_var,
                bg=self.PANEL,
                fg=self.TEXT,
                justify="left",
                wraplength=260,
                font=("Microsoft YaHei UI", 11),
            ).pack(anchor="w", pady=(6, 12))

            tk.Label(
                summary,
                textvariable=self.turn_points_var,
                bg=self.PANEL,
                fg=self.SUCCESS,
                font=("Microsoft YaHei UI", 12, "bold"),
            ).pack(anchor="w", pady=(0, 6))

            tk.Label(
                summary,
                textvariable=self.remaining_var,
                bg=self.PANEL,
                fg=self.TEXT,
                font=("Microsoft YaHei UI", 11),
            ).pack(anchor="w")

        def build_actions(self, parent):
            panel = tk.Frame(parent, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5")
            panel.grid(row=1, column=0, sticky="ew", pady=(0, 16))
            panel.grid_columnconfigure(0, weight=1)
            panel.grid_columnconfigure(1, weight=1)
            panel.grid_columnconfigure(2, weight=1)
            panel.grid_columnconfigure(3, weight=1)

            self.roll_button = tk.Button(
                panel,
                command=self.roll_current_dice,
                bg=self.ACCENT,
                fg="white",
                activebackground="#754d2b",
                activeforeground="white",
                relief="flat",
                padx=10,
                pady=10,
                cursor="hand2",
            )
            self.roll_button.grid(row=0, column=0, padx=12, pady=(14, 10), sticky="ew")

            self.take_button = tk.Button(
                panel,
                text="拿走所选并计分",
                command=self.take_selected_dice,
                bg=self.ACCENT_LIGHT,
                fg=self.TEXT,
                activebackground="#cfac68",
                activeforeground=self.TEXT,
                relief="flat",
                padx=10,
                pady=10,
                cursor="hand2",
            )
            self.take_button.grid(row=0, column=1, padx=12, pady=(14, 10), sticky="ew")

            self.continue_button = tk.Button(
                panel,
                command=self.continue_turn,
                bg="#d6e3c7",
                fg=self.TEXT,
                activebackground="#bdd3a2",
                activeforeground=self.TEXT,
                relief="flat",
                padx=10,
                pady=10,
                cursor="hand2",
            )
            self.continue_button.grid(row=0, column=2, padx=12, pady=(14, 10), sticky="ew")

            self.bank_button = tk.Button(
                panel,
                text="本回合入账",
                command=self.bank_turn,
                bg="#e8d4bb",
                fg=self.TEXT,
                activebackground="#d9b88c",
                activeforeground=self.TEXT,
                relief="flat",
                padx=10,
                pady=10,
                cursor="hand2",
            )
            self.bank_button.grid(row=0, column=3, padx=12, pady=(14, 10), sticky="ew")

            self.selection_label = tk.Label(
                panel,
                textvariable=self.selection_var,
                bg=self.PANEL,
                fg=self.MUTED,
                justify="left",
                anchor="w",
                font=("Microsoft YaHei UI", 10),
            )
            self.selection_label.grid(row=1, column=0, columnspan=4, padx=14, pady=(0, 14), sticky="ew")

        def build_dice_area(self, parent):
            panel = tk.Frame(parent, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5")
            panel.grid(row=2, column=0, sticky="nsew")
            panel.grid_rowconfigure(1, weight=1)
            panel.grid_columnconfigure(0, weight=1)

            tk.Label(
                panel,
                text="骰子区",
                bg=self.PANEL,
                fg=self.TEXT,
                font=("Microsoft YaHei UI", 12, "bold"),
            ).grid(row=0, column=0, padx=16, pady=(16, 10), sticky="w")

            self.dice_container = tk.Frame(panel, bg=self.PANEL)
            self.dice_container.grid(row=1, column=0, padx=10, pady=(0, 10), sticky="nsew")

        def build_log_panel(self, parent):
            panel = tk.Frame(parent, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5")
            panel.grid(row=0, column=0, sticky="nsew", pady=(0, 16))
            panel.grid_rowconfigure(1, weight=1)
            panel.grid_columnconfigure(0, weight=1)

            tk.Label(
                panel,
                text="对局日志",
                bg=self.PANEL,
                fg=self.TEXT,
                font=("Microsoft YaHei UI", 12, "bold"),
            ).grid(row=0, column=0, padx=16, pady=(16, 10), sticky="w")

            log_wrap = tk.Frame(panel, bg=self.PANEL)
            log_wrap.grid(row=1, column=0, padx=16, pady=(0, 16), sticky="nsew")
            log_wrap.grid_rowconfigure(0, weight=1)
            log_wrap.grid_columnconfigure(0, weight=1)

            self.log_text = tk.Text(
                log_wrap,
                bg="#fffdf8",
                fg=self.TEXT,
                relief="flat",
                wrap="word",
                padx=12,
                pady=12,
                highlightthickness=1,
                highlightbackground="#d7c19c",
            )
            self.log_text.grid(row=0, column=0, sticky="nsew")

            scrollbar = tk.Scrollbar(log_wrap, command=self.log_text.yview)
            scrollbar.grid(row=0, column=1, sticky="ns")
            self.log_text.configure(yscrollcommand=scrollbar.set)

        def build_rules_panel(self, parent):
            panel = tk.Frame(parent, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5")
            panel.grid(row=1, column=0, sticky="nsew")
            panel.grid_columnconfigure(0, weight=1)

            tk.Label(
                panel,
                text="计分规则",
                bg=self.PANEL,
                fg=self.TEXT,
                font=("Microsoft YaHei UI", 12, "bold"),
            ).grid(row=0, column=0, padx=16, pady=(16, 10), sticky="w")

            rules_text = "\n".join(f"• {rule}" for rule in RULES)
            tk.Label(
                panel,
                text=rules_text,
                bg=self.PANEL,
                fg=self.TEXT,
                justify="left",
                anchor="nw",
                wraplength=360,
                font=("Microsoft YaHei UI", 10),
            ).grid(row=1, column=0, padx=16, pady=(0, 16), sticky="nsew")

        def clear_log(self):
            self.log_text.configure(state="normal")
            self.log_text.delete("1.0", "end")
            self.log_text.configure(state="disabled")

        def log(self, message):
            self.log_text.configure(state="normal")
            self.log_text.insert("end", f"{message}\n")
            self.log_text.see("end")
            self.log_text.configure(state="disabled")

        def parse_positive_int(self, raw_value, field_name):
            text = raw_value.strip()
            if not text:
                return None
            if not text.isdigit() or int(text) <= 0:
                messagebox.showerror("输入错误", f"{field_name}必须是正整数。")
                return False
            return int(text)

        def parse_optional_seed(self, raw_value):
            text = raw_value.strip()
            if not text:
                return None
            try:
                return int(text)
            except ValueError:
                messagebox.showerror("输入错误", "随机种子必须是整数。")
                return False

        def start_new_game(self):
            parsed_target = self.parse_positive_int(self.target_var.get(), "目标分数")
            if parsed_target is False:
                return
            if parsed_target is None:
                parsed_target = DEFAULT_TARGET_SCORE
                self.target_var.set(str(parsed_target))

            parsed_seed = self.parse_optional_seed(self.seed_var.get())
            if parsed_seed is False:
                return

            self.target_score = parsed_target
            self.rng = random.Random(parsed_seed)
            self.scores = {"A": 0, "B": 0}
            self.current_player = "A"
            self.turn_points = 0
            self.remaining_dice = 6
            self.current_roll = []
            self.selected_indices = set()
            self.game_over = False
            self.awaiting_selection = False

            self.clear_log()
            self.log(f"新游戏开始，目标分数：{self.target_score}。")
            if parsed_seed is not None:
                self.log(f"固定随机种子：{parsed_seed}。")
            self.log("玩家 A 先手。")

            self.status_var.set("轮到玩家 A，点击“掷骰”开始回合。")
            self.selection_var.set("当前选择：未选择。")
            self.refresh_summary()
            self.set_button_states(roll=True, take=False, cont=False, bank=False)
            self.render_dice()

        def refresh_summary(self):
            self.turn_points_var.set(f"本回合暂存：{self.turn_points} 分")
            self.remaining_var.set(f"待掷骰子：{self.remaining_dice} 颗    目标分数：{self.target_score}")
            for player in ("A", "B"):
                self.score_vars[player].set(str(self.scores[player]))
                card_bg = self.ACCENT_LIGHT if player == self.current_player and not self.game_over else self.PANEL_ALT
                name_fg = self.TEXT if not self.game_over or player != self.current_player else self.MUTED
                for widget_name in ("frame", "name", "score"):
                    widget = self.player_cards[player][widget_name]
                    widget.configure(bg=card_bg)
                    if widget_name != "frame":
                        widget.configure(fg=name_fg if widget_name == "name" else self.TEXT)

            roll_text = f"掷 {self.remaining_dice} 颗骰子"
            cont_text = f"继续掷剩余 {self.remaining_dice} 颗"
            self.roll_button.configure(text=roll_text)
            self.continue_button.configure(text=cont_text)

        def set_button_states(self, roll, take, cont, bank):
            self.roll_button.configure(state="normal" if roll else "disabled")
            self.take_button.configure(state="normal" if take else "disabled")
            self.continue_button.configure(state="normal" if cont else "disabled")
            self.bank_button.configure(state="normal" if bank else "disabled")

        def render_dice(self):
            for child in self.dice_container.winfo_children():
                child.destroy()

            if not self.current_roll:
                placeholder = tk.Label(
                    self.dice_container,
                    text="当前没有可选骰子。\n点击上方按钮开始当前阶段。",
                    bg=self.PANEL,
                    fg=self.MUTED,
                    font=("Microsoft YaHei UI", 12),
                    pady=40,
                )
                placeholder.pack(fill="both", expand=True)
                return

            columns = min(3, len(self.current_roll))
            for column in range(columns):
                self.dice_container.grid_columnconfigure(column, weight=1)

            for index, value in enumerate(self.current_roll):
                selected = index in self.selected_indices
                button = tk.Button(
                    self.dice_container,
                    text=f"{value}\n第 {index + 1} 颗",
                    command=lambda idx=index: self.toggle_die(idx),
                    bg=self.ACCENT_LIGHT if selected else "#fffdf8",
                    fg=self.TEXT,
                    activebackground="#ecd2a6",
                    activeforeground=self.TEXT,
                    relief="sunken" if selected else "raised",
                    bd=2,
                    width=10,
                    height=4,
                    font=("Microsoft YaHei UI", 15, "bold"),
                    cursor="hand2",
                    state="normal" if self.awaiting_selection else "disabled",
                )
                button.grid(row=index // columns, column=index % columns, padx=10, pady=10, sticky="nsew")

        def toggle_die(self, index):
            if not self.awaiting_selection or self.game_over:
                return
            if index in self.selected_indices:
                self.selected_indices.remove(index)
            else:
                self.selected_indices.add(index)
            self.update_selection_preview()
            self.render_dice()

        def update_selection_preview(self):
            if not self.selected_indices:
                self.selection_var.set("当前选择：未选择。")
                self.selection_label.configure(fg=self.MUTED)
                self.set_button_states(roll=False, take=False, cont=False, bank=False)
                return

            selected_values = [self.current_roll[index] for index in sorted(self.selected_indices)]
            points = score_selection(selected_values)
            if points > 0:
                self.selection_var.set(f"当前选择：{selected_values}，可获得 {points} 分。")
                self.selection_label.configure(fg=self.SUCCESS)
                self.set_button_states(roll=False, take=True, cont=False, bank=False)
            else:
                self.selection_var.set(f"当前选择：{selected_values}，不是有效得分组合。")
                self.selection_label.configure(fg=self.DANGER)
                self.set_button_states(roll=False, take=False, cont=False, bank=False)

        def roll_current_dice(self):
            if self.game_over:
                return

            self.current_roll = roll_dice(self.remaining_dice, self.rng)
            self.selected_indices = set()
            self.awaiting_selection = True
            self.selection_var.set("当前选择：未选择。")
            self.selection_label.configure(fg=self.MUTED)
            self.status_var.set(f"玩家 {self.current_player} 已掷骰，请选择要计分的骰子。")
            self.log(f"玩家 {self.current_player} 掷出：{format_roll(self.current_roll)}")
            self.refresh_summary()
            self.set_button_states(roll=False, take=False, cont=False, bank=False)
            self.render_dice()

            if not has_scoring_option(self.current_roll):
                self.awaiting_selection = False
                self.status_var.set(f"玩家 {self.current_player} 没有得分组合，本回合分数作废。")
                self.log(f"玩家 {self.current_player} 本次没有得分组合，回合结束。")
                self.render_dice()
                messagebox.showinfo(
                    "无得分组合",
                    f"玩家 {self.current_player} 掷出了 {self.current_roll}，没有任何得分组合，本回合得分作废。",
                )
                self.finish_turn(bank_points=False)

        def take_selected_dice(self):
            if self.game_over or not self.selected_indices:
                return

            selected_values = [self.current_roll[index] for index in sorted(self.selected_indices)]
            gained = score_selection(selected_values)
            if gained <= 0:
                messagebox.showwarning("选择无效", "所选骰子不能组成有效得分，请重新选择。")
                return

            self.turn_points += gained
            self.remaining_dice -= len(selected_values)
            self.log(
                f"玩家 {self.current_player} 拿走 {selected_values}，获得 {gained} 分，"
                f"本回合暂存 {self.turn_points} 分。"
            )

            hot_dice = False
            if self.remaining_dice == 0:
                self.remaining_dice = 6
                hot_dice = True
                self.log("本轮所有骰子都已拿走，下一掷重新恢复 6 颗。")

            self.current_roll = []
            self.selected_indices = set()
            self.awaiting_selection = False
            self.selection_var.set("当前选择：已结算。")
            self.selection_label.configure(fg=self.SUCCESS)

            if hot_dice:
                self.status_var.set(f"玩家 {self.current_player} 触发热骰，可重新掷 6 颗骰子。")
            else:
                self.status_var.set(f"玩家 {self.current_player} 可以继续掷骰，或把本回合分数入账。")

            self.refresh_summary()
            self.set_button_states(roll=False, take=False, cont=True, bank=True)
            self.render_dice()

        def continue_turn(self):
            if self.game_over:
                return
            self.roll_current_dice()

        def bank_turn(self):
            if self.game_over or self.turn_points <= 0:
                return
            self.finish_turn(bank_points=True)

        def finish_turn(self, bank_points):
            player = self.current_player
            if bank_points:
                self.scores[player] += self.turn_points
                self.log(f"玩家 {player} 把 {self.turn_points} 分记入总分，总分来到 {self.scores[player]}。")

                if self.scores[player] >= self.target_score:
                    self.game_over = True
                    self.current_roll = []
                    self.selected_indices = set()
                    self.awaiting_selection = False
                    self.status_var.set(f"玩家 {player} 达到 {self.target_score} 分，赢下对局。")
                    self.selection_var.set("当前选择：对局结束，点击“开始新游戏”可重开。")
                    self.refresh_summary()
                    self.set_button_states(roll=False, take=False, cont=False, bank=False)
                    self.render_dice()
                    self.log(f"玩家 {player} 获胜。")
                    messagebox.showinfo("游戏结束", f"玩家 {player} 率先达到 {self.target_score} 分，获胜！")
                    return

            next_player = "B" if player == "A" else "A"
            self.current_player = next_player
            self.turn_points = 0
            self.remaining_dice = 6
            self.current_roll = []
            self.selected_indices = set()
            self.awaiting_selection = False
            self.selection_var.set("当前选择：未选择。")
            self.selection_label.configure(fg=self.MUTED)
            self.status_var.set(f"轮到玩家 {next_player}，点击“掷骰”开始回合。")
            self.log(f"轮到玩家 {next_player}。")
            self.refresh_summary()
            self.set_button_states(roll=True, take=False, cont=False, bank=False)
            self.render_dice()

    root = tk.Tk()
    app = DiceGameGUI(root, target_score, seed)
    app.root.mainloop()


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


if __name__ == "__main__":
    main()
