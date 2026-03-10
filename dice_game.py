import argparse
import random
import sys
from functools import lru_cache


DEFAULT_TARGET_SCORE = 5000
RULES = [
    "一个 1 = 100 分",
    "一个 5 = 50 分",
    "1 2 3 4 5 = 500 分",
    "2 3 4 5 6 = 750 分",
    "1 2 3 4 5 6 = 1500 分",
    "三个 1 = 1000 分",
    "三个 2 / 3 / 4 / 5 / 6 = 200 / 300 / 400 / 500 / 600 分",
    "三个相同点数之后，每多一个相同骰子，当前组合分数翻倍",
]

STRAIGHT_PATTERNS = (
    ((1, 1, 1, 1, 1, 0), 500),
    ((0, 1, 1, 1, 1, 1), 750),
    ((1, 1, 1, 1, 1, 1), 1500),
)

THREE_OF_A_KIND_BASE_SCORES = {
    1: 1000,
    2: 200,
    3: 300,
    4: 400,
    5: 500,
    6: 600,
}


def counts_key(dice):
    counts = [0] * 6
    for value in dice:
        if value < 1 or value > 6:
            raise ValueError("Dice values must be between 1 and 6.")
        counts[value - 1] += 1
    return tuple(counts)


def score_of_kind(face, count):
    if not 3 <= count <= 6:
        raise ValueError("Only 3-6 of a kind are supported.")
    return THREE_OF_A_KIND_BASE_SCORES[face] * (2 ** (count - 3))


@lru_cache(maxsize=None)
def score_counts(counts):
    if sum(counts) == 0:
        return 0

    best = -1

    for pattern, points in STRAIGHT_PATTERNS:
        if all(counts[index] >= pattern[index] for index in range(6)):
            next_counts = tuple(counts[index] - pattern[index] for index in range(6))
            remainder = score_counts(next_counts)
            if sum(next_counts) == 0 or remainder >= 0:
                best = max(best, points + max(remainder, 0))

    for face in range(1, 7):
        current = counts[face - 1]
        if current >= 3:
            for kind_size in range(3, current + 1):
                next_counts = list(counts)
                next_counts[face - 1] -= kind_size
                next_counts = tuple(next_counts)
                remainder = score_counts(next_counts)
                if sum(next_counts) == 0 or remainder >= 0:
                    best = max(best, score_of_kind(face, kind_size) + max(remainder, 0))

    for face, single_score in ((1, 100), (5, 50)):
        current = counts[face - 1]
        if current >= 1:
            next_counts = list(counts)
            next_counts[face - 1] -= 1
            next_counts = tuple(next_counts)
            remainder = score_counts(next_counts)
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


def launch_gui(target_score=DEFAULT_TARGET_SCORE, seed=None):
    try:
        import tkinter as tk
        from tkinter import font as tkfont
        from tkinter import messagebox
    except ImportError as exc:
        raise RuntimeError("当前 Python 环境不支持 tkinter，无法启动图形界面。") from exc

    class DiceGameGUI:
        BASE_WIDTH = 1280
        BASE_HEIGHT = 900
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
            self.root.title("摇骰子游戏")
            self.root.configure(bg=self.BG)
            self.root.geometry(f"{self.BASE_WIDTH}x{self.BASE_HEIGHT}")
            self.root.minsize(520, 360)

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
            self.awaiting_selection = False
            self.game_over = False
            self.rng = random.Random(initial_seed)
            self.ui_scale = 1.0
            self.resize_job = None
            self.design_width = self.BASE_WIDTH
            self.design_height = self.BASE_HEIGHT

            self.player_cards = {}
            self.history = []
            self.fonts = {}
            self.dice_container = None
            self.selection_label = None
            self.roll_button = None
            self.take_button = None
            self.continue_button = None
            self.bank_button = None
            self.rules_button = None
            self.rules_window = None
            self.rules_window_title = None
            self.rules_window_body = None
            self.rules_window_close = None

            self.build_fonts(tkfont)
            self.build_layout()
            self.start_new_game()
            self.capture_design_size()
            self.root.bind("<Configure>", self.on_root_resize)
            self.root.after(0, self.force_refresh_scale)

        def build_fonts(self, tkfont_module):
            family = "Microsoft YaHei UI"
            self.fonts = {
                "body": tkfont_module.Font(family=family, size=10),
                "title": tkfont_module.Font(family=family, size=24, weight="bold"),
                "subtitle": tkfont_module.Font(family=family, size=11),
                "section": tkfont_module.Font(family=family, size=18, weight="bold"),
                "label_bold": tkfont_module.Font(family=family, size=10, weight="bold"),
                "summary": tkfont_module.Font(family=family, size=11),
                "summary_bold": tkfont_module.Font(family=family, size=12, weight="bold"),
                "score": tkfont_module.Font(family=family, size=24, weight="bold"),
                "button": tkfont_module.Font(family=family, size=10, weight="bold"),
                "selection": tkfont_module.Font(family=family, size=11),
                "rule": tkfont_module.Font(family=family, size=10),
                "die_tag": tkfont_module.Font(family=family, size=9, weight="bold"),
                "die_label": tkfont_module.Font(family=family, size=10, weight="bold"),
                "placeholder": tkfont_module.Font(family=family, size=16, weight="bold"),
            }

        def scaled(self, value, minimum=1):
            return max(minimum, int(round(value * self.ui_scale)))

        def font_size(self, base, minimum=4):
            return max(minimum, int(round(base * self.ui_scale)))

        def on_root_resize(self, event):
            if event.widget is not self.root:
                return
            if self.resize_job is not None:
                self.root.after_cancel(self.resize_job)
            self.resize_job = self.root.after(40, self.refresh_scale)

        def force_refresh_scale(self):
            self.ui_scale = 0
            self.refresh_scale()

        def capture_design_size(self):
            self.root.update_idletasks()
            self.design_width = max(self.BASE_WIDTH, self.root.winfo_reqwidth())
            self.design_height = max(self.BASE_HEIGHT, self.root.winfo_reqheight())

        def refresh_scale(self):
            self.resize_job = None
            width = max(self.root.winfo_width(), 1)
            height = max(self.root.winfo_height(), 1)
            next_scale = min(width / self.design_width, height / self.design_height)
            next_scale = max(0.2, min(1.45, next_scale))
            if abs(next_scale - self.ui_scale) < 0.02:
                return

            self.ui_scale = next_scale
            self.apply_scale()
            self.render_dice()

        def build_layout(self):
            self.header_frame = tk.Frame(self.root, bg=self.BG)
            self.header_frame.pack(fill="x", padx=24, pady=(20, 12))

            self.title_label = tk.Label(
                self.header_frame,
                text="摇骰子游戏",
                bg=self.BG,
                fg=self.TEXT,
                font=self.fonts["title"],
            )
            self.title_label.pack(anchor="w")

            self.subtitle_label = tk.Label(
                self.header_frame,
                text="双人轮流选择计分骰子，决定继续冒险还是立即入账。",
                bg=self.BG,
                fg=self.MUTED,
                font=self.fonts["subtitle"],
            )
            self.subtitle_label.pack(anchor="w", pady=(4, 0))

            self.controls_panel = tk.Frame(
                self.root, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5"
            )
            self.controls_panel.pack(fill="x", padx=24, pady=(0, 16))

            self.target_label = tk.Label(
                self.controls_panel,
                text="目标分数",
                bg=self.PANEL,
                fg=self.TEXT,
                font=self.fonts["label_bold"],
            )
            self.target_label.grid(row=0, column=0, padx=(18, 8), pady=16, sticky="w")
            self.target_entry = tk.Entry(
                self.controls_panel,
                textvariable=self.target_var,
                width=10,
                relief="flat",
                highlightthickness=1,
                highlightbackground="#cab38d",
                font=self.fonts["body"],
            )
            self.target_entry.grid(row=0, column=1, padx=(0, 16), pady=16, sticky="w")

            self.seed_label = tk.Label(
                self.controls_panel,
                text="随机种子",
                bg=self.PANEL,
                fg=self.TEXT,
                font=self.fonts["label_bold"],
            )
            self.seed_label.grid(row=0, column=2, padx=(0, 8), pady=16, sticky="w")
            self.seed_entry = tk.Entry(
                self.controls_panel,
                textvariable=self.seed_var,
                width=12,
                relief="flat",
                highlightthickness=1,
                highlightbackground="#cab38d",
                font=self.fonts["body"],
            )
            self.seed_entry.grid(row=0, column=3, padx=(0, 16), pady=16, sticky="w")

            self.new_game_button = tk.Button(
                self.controls_panel,
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
                font=self.fonts["button"],
            )
            self.new_game_button.grid(row=0, column=4, padx=(0, 18), pady=16, sticky="w")
            self.rules_button = tk.Button(
                self.controls_panel,
                text="计分规则",
                command=self.show_rules_window,
                bg=self.PANEL_ALT,
                fg=self.TEXT,
                activebackground="#eadcbf",
                activeforeground=self.TEXT,
                relief="flat",
                padx=14,
                pady=8,
                cursor="hand2",
                font=self.fonts["button"],
            )
            self.rules_button.grid(row=0, column=5, padx=(0, 18), pady=16, sticky="w")
            self.controls_panel.grid_columnconfigure(6, weight=1)

            self.main_frame = tk.Frame(self.root, bg=self.BG)
            self.main_frame.pack(fill="both", expand=True, padx=24, pady=(0, 24))
            self.main_frame.grid_columnconfigure(0, weight=1)
            self.main_frame.grid_rowconfigure(0, weight=0)
            self.main_frame.grid_rowconfigure(1, weight=1)

            self.build_scoreboard(self.main_frame)
            self.build_throw_stage(self.main_frame)
            self.build_actions(self.felt_frame)

        def build_scoreboard(self, parent):
            self.scoreboard_panel = tk.Frame(
                parent, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5"
            )
            self.scoreboard_panel.grid(row=0, column=0, sticky="ew", pady=(0, 16))
            for column in range(3):
                self.scoreboard_panel.grid_columnconfigure(column, weight=1)

            for column, player in enumerate(("A", "B")):
                frame = tk.Frame(
                    self.scoreboard_panel,
                    bg=self.PANEL_ALT,
                    highlightthickness=2,
                    highlightbackground="#d7c19c",
                )
                frame.grid(row=0, column=column, padx=14, pady=14, sticky="nsew")
                name_label = tk.Label(
                    frame,
                    text=f"玩家 {player}",
                    bg=self.PANEL_ALT,
                    fg=self.TEXT,
                    font=self.fonts["summary"],
                )
                name_label.pack(anchor="w", padx=14, pady=(14, 6))
                score_label = tk.Label(
                    frame,
                    textvariable=self.score_vars[player],
                    bg=self.PANEL_ALT,
                    fg=self.TEXT,
                    font=self.fonts["score"],
                )
                score_label.pack(anchor="w", padx=14, pady=(0, 14))
                self.player_cards[player] = {
                    "frame": frame,
                    "name": name_label,
                    "score": score_label,
                }

            self.summary_frame = tk.Frame(self.scoreboard_panel, bg=self.PANEL)
            self.summary_frame.grid(row=0, column=2, padx=14, pady=14, sticky="nsew")
            self.summary_title = tk.Label(
                self.summary_frame,
                text="当前回合",
                bg=self.PANEL,
                fg=self.MUTED,
                font=self.fonts["label_bold"],
            )
            self.summary_title.pack(anchor="w")
            self.summary_status = tk.Label(
                self.summary_frame,
                textvariable=self.status_var,
                bg=self.PANEL,
                fg=self.TEXT,
                justify="left",
                wraplength=260,
                font=self.fonts["summary"],
            )
            self.summary_status.pack(anchor="w", pady=(6, 12))
            self.summary_turn_points = tk.Label(
                self.summary_frame,
                textvariable=self.turn_points_var,
                bg=self.PANEL,
                fg=self.SUCCESS,
                font=self.fonts["summary_bold"],
            )
            self.summary_turn_points.pack(anchor="w", pady=(0, 6))
            self.summary_remaining = tk.Label(
                self.summary_frame,
                textvariable=self.remaining_var,
                bg=self.PANEL,
                fg=self.TEXT,
                font=self.fonts["summary"],
            )
            self.summary_remaining.pack(anchor="w")

        def build_throw_stage(self, parent):
            self.stage_panel = tk.Frame(
                parent, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5"
            )
            self.stage_panel.grid(row=1, column=0, sticky="nsew", pady=(0, 16))
            self.stage_panel.grid_rowconfigure(1, weight=1)
            self.stage_panel.grid_columnconfigure(0, weight=1)

            self.stage_header = tk.Frame(self.stage_panel, bg=self.PANEL)
            self.stage_header.grid(row=0, column=0, padx=18, pady=(18, 12), sticky="ew")
            self.stage_header.grid_columnconfigure(0, weight=1)

            self.stage_title = tk.Label(
                self.stage_header,
                text="掷骰台",
                bg=self.PANEL,
                fg=self.TEXT,
                font=self.fonts["section"],
            )
            self.stage_title.grid(row=0, column=0, sticky="w")
            self.stage_hint = tk.Label(
                self.stage_header,
                text="点击骰子选择要计分的组合，再决定继续掷骰还是把分数入账。",
                bg=self.PANEL,
                fg=self.MUTED,
                font=self.fonts["body"],
            )
            self.stage_hint.grid(row=1, column=0, pady=(6, 0), sticky="w")

            self.felt_frame = tk.Frame(
                self.stage_panel, bg="#62743c", highlightthickness=1, highlightbackground="#435028"
            )
            self.felt_frame.grid(row=1, column=0, padx=18, pady=(0, 18), sticky="nsew")
            self.felt_frame.grid_rowconfigure(0, weight=1)
            self.felt_frame.grid_rowconfigure(1, weight=0)
            self.felt_frame.grid_columnconfigure(0, weight=1)

            self.dice_container = tk.Frame(self.felt_frame, bg="#62743c")
            self.dice_container.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")

        def build_actions(self, parent):
            self.actions_panel = tk.Frame(
                parent, bg="#556b32", highlightthickness=0, bd=0
            )
            self.actions_panel.grid(row=1, column=0, sticky="ew", padx=20, pady=(0, 20))

            self.roll_button = tk.Button(
                self.actions_panel,
                command=self.roll_current_dice,
                bg=self.ACCENT,
                fg="white",
                activebackground="#754d2b",
                activeforeground="white",
                relief="flat",
                padx=8,
                pady=6,
                cursor="hand2",
                font=self.fonts["button"],
            )
            self.roll_button.grid(row=0, column=0, padx=8, pady=(10, 8), sticky="ew")

            self.take_button = tk.Button(
                self.actions_panel,
                text="拿走所选并计分",
                command=self.take_selected_dice,
                bg=self.ACCENT_LIGHT,
                fg=self.TEXT,
                activebackground="#cfac68",
                activeforeground=self.TEXT,
                relief="flat",
                padx=8,
                pady=6,
                cursor="hand2",
                font=self.fonts["button"],
            )
            self.take_button.grid(row=0, column=1, padx=8, pady=(10, 8), sticky="ew")

            self.continue_button = tk.Button(
                self.actions_panel,
                command=self.continue_turn,
                bg="#d6e3c7",
                fg=self.TEXT,
                activebackground="#bdd3a2",
                activeforeground=self.TEXT,
                relief="flat",
                padx=8,
                pady=6,
                cursor="hand2",
                font=self.fonts["button"],
            )
            self.continue_button.grid(row=0, column=2, padx=8, pady=(10, 8), sticky="ew")

            self.bank_button = tk.Button(
                self.actions_panel,
                text="本回合入账",
                command=self.bank_turn,
                bg="#e8d4bb",
                fg=self.TEXT,
                activebackground="#d9b88c",
                activeforeground=self.TEXT,
                relief="flat",
                padx=8,
                pady=6,
                cursor="hand2",
                font=self.fonts["button"],
            )
            self.bank_button.grid(row=0, column=3, padx=8, pady=(10, 8), sticky="ew")

            for column in range(4):
                self.actions_panel.grid_columnconfigure(column, weight=1)

            self.selection_label = tk.Label(
                self.actions_panel,
                textvariable=self.selection_var,
                bg="#556b32",
                fg="#edf3d8",
                justify="center",
                wraplength=860,
                font=self.fonts["selection"],
            )
            self.selection_label.grid(row=1, column=0, columnspan=4, padx=12, pady=(0, 10), sticky="ew")

        def build_rules_panel(self, parent):
            self.rules_panel = tk.Frame(
                parent, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5"
            )
            self.rules_panel.grid(row=3, column=0, sticky="ew")
            self.rules_panel.grid_columnconfigure(0, weight=1)

            self.rules_panel_title = tk.Label(
                self.rules_panel,
                text="计分规则",
                bg=self.PANEL,
                fg=self.TEXT,
                font=self.fonts["summary_bold"],
            )
            self.rules_panel_title.grid(row=0, column=0, padx=16, pady=(16, 10), sticky="w")

            rules_text = "\n".join(f"- {rule}" for rule in RULES)
            self.rules_body = tk.Label(
                self.rules_panel,
                text=rules_text,
                bg=self.PANEL,
                fg=self.TEXT,
                justify="left",
                anchor="nw",
                wraplength=900,
                font=self.fonts["rule"],
            )
            self.rules_body.grid(row=1, column=0, padx=16, pady=(0, 16), sticky="ew")

        def show_rules_window(self):
            if self.rules_window is not None and self.rules_window.winfo_exists():
                self.rules_window.lift()
                self.rules_window.focus_force()
                return

            top = tk.Toplevel(self.root)
            top.title("计分规则")
            top.configure(bg=self.BG)
            top.geometry("520x420")
            top.minsize(360, 280)
            top.transient(self.root)
            top.protocol("WM_DELETE_WINDOW", self.close_rules_window)

            panel = tk.Frame(
                top, bg=self.PANEL, highlightthickness=1, highlightbackground="#dcc8a5"
            )
            panel.pack(fill="both", expand=True, padx=18, pady=18)

            self.rules_window_title = tk.Label(
                panel,
                text="计分规则",
                bg=self.PANEL,
                fg=self.TEXT,
                font=self.fonts["section"],
            )
            self.rules_window_title.pack(anchor="w", padx=18, pady=(18, 10))

            rules_text = "\n".join(f"- {rule}" for rule in RULES)
            self.rules_window_body = tk.Label(
                panel,
                text=rules_text,
                bg=self.PANEL,
                fg=self.TEXT,
                justify="left",
                anchor="nw",
                wraplength=420,
                font=self.fonts["rule"],
            )
            self.rules_window_body.pack(fill="both", expand=True, padx=18, pady=(0, 14))

            self.rules_window_close = tk.Button(
                panel,
                text="关闭",
                command=self.close_rules_window,
                bg=self.ACCENT,
                fg="white",
                activebackground="#754d2b",
                activeforeground="white",
                relief="flat",
                padx=14,
                pady=6,
                cursor="hand2",
                font=self.fonts["button"],
            )
            self.rules_window_close.pack(anchor="e", padx=18, pady=(0, 18))

            self.rules_window = top
            self.update_rules_window_scale()

        def close_rules_window(self):
            if self.rules_window is not None and self.rules_window.winfo_exists():
                self.rules_window.destroy()
            self.rules_window = None
            self.rules_window_title = None
            self.rules_window_body = None
            self.rules_window_close = None

        def update_rules_window_scale(self):
            if self.rules_window is None or not self.rules_window.winfo_exists():
                return
            self.rules_window_title.configure(font=self.fonts["section"])
            self.rules_window_body.configure(
                font=self.fonts["rule"], wraplength=self.scaled(420)
            )
            self.rules_window_close.configure(
                font=self.fonts["button"],
                padx=self.scaled(14),
                pady=self.scaled(6),
            )

        def apply_scale(self):
            self.fonts["body"].configure(size=self.font_size(10))
            self.fonts["title"].configure(size=self.font_size(24, 12))
            self.fonts["subtitle"].configure(size=self.font_size(11))
            self.fonts["section"].configure(size=self.font_size(18, 10))
            self.fonts["label_bold"].configure(size=self.font_size(10))
            self.fonts["summary"].configure(size=self.font_size(11))
            self.fonts["summary_bold"].configure(size=self.font_size(12))
            self.fonts["score"].configure(size=self.font_size(24, 12))
            self.fonts["button"].configure(size=self.font_size(10))
            self.fonts["selection"].configure(size=self.font_size(11))
            self.fonts["rule"].configure(size=self.font_size(10))
            self.fonts["die_tag"].configure(size=self.font_size(9, 5))
            self.fonts["die_label"].configure(size=self.font_size(10))
            self.fonts["placeholder"].configure(size=self.font_size(16, 9))

            self.header_frame.pack_configure(
                padx=self.scaled(24), pady=(self.scaled(20), self.scaled(12))
            )
            self.controls_panel.pack_configure(
                padx=self.scaled(24), pady=(0, self.scaled(16))
            )
            self.main_frame.pack_configure(
                padx=self.scaled(24), pady=(0, self.scaled(24))
            )

            self.title_label.configure(font=self.fonts["title"])
            self.subtitle_label.configure(font=self.fonts["subtitle"])

            self.target_label.grid_configure(
                padx=(self.scaled(18), self.scaled(8)), pady=self.scaled(16)
            )
            self.target_entry.grid_configure(
                padx=(0, self.scaled(16)), pady=self.scaled(16)
            )
            self.seed_label.grid_configure(
                padx=(0, self.scaled(8)), pady=self.scaled(16)
            )
            self.seed_entry.grid_configure(
                padx=(0, self.scaled(16)), pady=self.scaled(16)
            )
            self.new_game_button.grid_configure(
                padx=(0, self.scaled(18)), pady=self.scaled(16)
            )
            self.rules_button.grid_configure(
                padx=(0, self.scaled(18)), pady=self.scaled(16)
            )
            self.target_label.configure(font=self.fonts["label_bold"])
            self.seed_label.configure(font=self.fonts["label_bold"])
            self.target_entry.configure(font=self.fonts["body"])
            self.seed_entry.configure(font=self.fonts["body"])
            self.new_game_button.configure(
                font=self.fonts["button"],
                padx=self.scaled(18),
                pady=self.scaled(8),
            )
            self.rules_button.configure(
                font=self.fonts["button"],
                padx=self.scaled(14),
                pady=self.scaled(8),
            )

            self.scoreboard_panel.grid_configure(pady=(0, self.scaled(16)))
            self.summary_frame.grid_configure(
                padx=self.scaled(14), pady=self.scaled(14)
            )
            self.summary_title.configure(font=self.fonts["label_bold"])
            self.summary_status.configure(
                font=self.fonts["summary"], wraplength=self.scaled(260)
            )
            self.summary_status.pack_configure(pady=(self.scaled(6), self.scaled(12)))
            self.summary_turn_points.configure(font=self.fonts["summary_bold"])
            self.summary_turn_points.pack_configure(pady=(0, self.scaled(6)))
            self.summary_remaining.configure(font=self.fonts["summary"])

            for card in self.player_cards.values():
                card["frame"].grid_configure(
                    padx=self.scaled(14), pady=self.scaled(14)
                )
                card["name"].pack_configure(
                    padx=self.scaled(14), pady=(self.scaled(14), self.scaled(6))
                )
                card["score"].pack_configure(
                    padx=self.scaled(14), pady=(0, self.scaled(14))
                )
                card["name"].configure(font=self.fonts["summary"])
                card["score"].configure(font=self.fonts["score"])

            self.stage_panel.grid_configure(pady=(0, self.scaled(16)))
            self.stage_header.grid_configure(
                padx=self.scaled(18), pady=(self.scaled(18), self.scaled(12))
            )
            self.stage_title.configure(font=self.fonts["section"])
            self.stage_hint.configure(font=self.fonts["body"])
            self.stage_hint.grid_configure(pady=(self.scaled(6), 0))
            self.felt_frame.grid_configure(
                padx=self.scaled(18), pady=(0, self.scaled(18))
            )
            self.dice_container.grid_configure(
                padx=self.scaled(20), pady=self.scaled(20)
            )

            self.actions_panel.grid_configure(
                padx=self.scaled(20), pady=(0, self.scaled(20))
            )
            for button in (
                self.roll_button,
                self.take_button,
                self.continue_button,
                self.bank_button,
            ):
                button.configure(
                    font=self.fonts["button"],
                    padx=self.scaled(8),
                    pady=self.scaled(6),
                )
            self.roll_button.grid_configure(
                padx=self.scaled(8), pady=(self.scaled(10), self.scaled(8))
            )
            self.take_button.grid_configure(
                padx=self.scaled(8), pady=(self.scaled(10), self.scaled(8))
            )
            self.continue_button.grid_configure(
                padx=self.scaled(8), pady=(self.scaled(10), self.scaled(8))
            )
            self.bank_button.grid_configure(
                padx=self.scaled(8), pady=(self.scaled(10), self.scaled(8))
            )
            self.selection_label.configure(
                font=self.fonts["selection"], wraplength=self.scaled(860)
            )
            self.selection_label.grid_configure(
                padx=self.scaled(12), pady=(0, self.scaled(10))
            )
            self.update_rules_window_scale()

        def clear_log(self):
            self.history.clear()

        def log(self, message):
            self.history.append(message)

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
            self.current_player = "A"
            self.scores = {"A": 0, "B": 0}
            self.turn_points = 0
            self.remaining_dice = 6
            self.current_roll = []
            self.selected_indices = set()
            self.awaiting_selection = False
            self.game_over = False

            self.clear_log()
            self.log(f"新游戏开始，目标分数：{self.target_score}。")
            if parsed_seed is not None:
                self.log(f"随机种子：{parsed_seed}。")
            self.log("玩家 A 先手。")

            self.status_var.set("轮到玩家 A，点击“掷骰”开始回合。")
            self.selection_var.set("当前选择：未选择。")
            self.refresh_summary()
            self.set_button_states(roll=True, take=False, cont=False, bank=False)
            self.render_dice()

        def refresh_summary(self):
            self.turn_points_var.set(f"本回合暂存：{self.turn_points} 分")
            self.remaining_var.set(f"待掷骰子：{self.remaining_dice} 颗   目标分数：{self.target_score}")
            for player in ("A", "B"):
                self.score_vars[player].set(str(self.scores[player]))
                active = player == self.current_player and not self.game_over
                bg = self.ACCENT_LIGHT if active else self.PANEL_ALT
                name_fg = self.TEXT if active else self.MUTED
                self.player_cards[player]["frame"].configure(bg=bg)
                self.player_cards[player]["name"].configure(bg=bg, fg=name_fg)
                self.player_cards[player]["score"].configure(bg=bg, fg=self.TEXT)

            self.roll_button.configure(text=f"掷 {self.remaining_dice} 颗骰子")
            self.continue_button.configure(text=f"继续掷剩余 {self.remaining_dice} 颗")

        def set_button_states(self, roll, take, cont, bank):
            self.roll_button.configure(state="normal" if roll else "disabled")
            self.take_button.configure(state="normal" if take else "disabled")
            self.continue_button.configure(state="normal" if cont else "disabled")
            self.bank_button.configure(state="normal" if bank else "disabled")

        def render_dice(self):
            for child in self.dice_container.winfo_children():
                child.destroy()

            if not self.current_roll:
                tk.Label(
                    self.dice_container,
                    text="当前没有可选骰子。\n点击上方按钮开始当前阶段。",
                    bg="#62743c",
                    fg="#edf3d8",
                    font=self.fonts["placeholder"],
                    pady=self.scaled(90),
                ).pack(fill="both", expand=True)
                return

            columns = min(6, len(self.current_roll))
            for column in range(columns):
                self.dice_container.grid_columnconfigure(column, weight=1)

            for index, value in enumerate(self.current_roll):
                selected = index in self.selected_indices
                slot = tk.Frame(self.dice_container, bg="#62743c")
                slot.grid(
                    row=index // columns,
                    column=index % columns,
                    padx=self.scaled(12),
                    pady=self.scaled(12),
                )

                canvas = tk.Canvas(
                    slot,
                    width=self.scaled(122),
                    height=self.scaled(148),
                    bg="#62743c",
                    highlightthickness=0,
                    bd=0,
                    cursor="hand2" if self.awaiting_selection else "arrow",
                )
                canvas.pack()
                self.draw_die(canvas, value, index, selected, self.awaiting_selection and not self.game_over)

        def draw_die(self, canvas, value, index, selected, enabled):
            shadow_fill = "#44512a" if enabled else "#556040"
            face_fill = "#fffdf8" if enabled else "#ede5d3"
            outline = self.ACCENT if selected else "#d8c7a0"
            pip_fill = self.TEXT if enabled else "#8a7d69"

            canvas.create_rectangle(
                self.scaled(21),
                self.scaled(28),
                self.scaled(107),
                self.scaled(114),
                fill=shadow_fill,
                outline="",
            )
            canvas.create_rectangle(
                self.scaled(15),
                self.scaled(20),
                self.scaled(101),
                self.scaled(106),
                fill=face_fill,
                outline=outline,
                width=self.scaled(4) if selected else self.scaled(2),
                tags=("die",),
            )

            for x, y in self.pip_centers(value):
                radius = self.scaled(7)
                canvas.create_oval(
                    x - radius,
                    y - radius,
                    x + radius,
                    y + radius,
                    fill=pip_fill,
                    outline="",
                    tags=("die",),
                )

            if selected:
                canvas.create_text(
                    self.scaled(58),
                    self.scaled(8),
                    text="已选",
                    fill="#f6e2a8",
                    font=self.fonts["die_tag"],
                    tags=("die",),
                )

            label_color = "#f8f3e8" if enabled else "#d8d0bf"
            canvas.create_text(
                self.scaled(58),
                self.scaled(129),
                text=f"第 {index + 1} 颗",
                fill=label_color,
                font=self.fonts["die_label"],
                tags=("die",),
            )

            if enabled:
                canvas.tag_bind("die", "<Button-1>", lambda _event, idx=index: self.toggle_die(idx))

        def pip_centers(self, value):
            positions = {
                "tl": (self.scaled(33), self.scaled(38)),
                "tc": (self.scaled(58), self.scaled(38)),
                "tr": (self.scaled(83), self.scaled(38)),
                "ml": (self.scaled(33), self.scaled(63)),
                "mc": (self.scaled(58), self.scaled(63)),
                "mr": (self.scaled(83), self.scaled(63)),
                "bl": (self.scaled(33), self.scaled(88)),
                "bc": (self.scaled(58), self.scaled(88)),
                "br": (self.scaled(83), self.scaled(88)),
            }
            layouts = {
                1: ("mc",),
                2: ("tl", "br"),
                3: ("tl", "mc", "br"),
                4: ("tl", "tr", "bl", "br"),
                5: ("tl", "tr", "mc", "bl", "br"),
                6: ("tl", "tr", "ml", "mr", "bl", "br"),
            }
            return [positions[key] for key in layouts[value]]

        def toggle_die(self, index):
            if self.game_over or not self.awaiting_selection:
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
                self.selection_var.set("当前选择：本次掷骰没有可得分组合。")
                self.log(f"玩家 {self.current_player} 本次没有得分组合，回合结束。")
                self.render_dice()
                messagebox.showinfo(
                    "无得分组合",
                    f"玩家 {self.current_player} 掷出 {self.current_roll}，本回合暂存分数作废。",
                )
                self.finish_turn(bank_points=False)

        def take_selected_dice(self):
            if self.game_over or not self.selected_indices:
                return

            selected_values = [self.current_roll[index] for index in sorted(self.selected_indices)]
            gained = score_selection(selected_values)
            if gained <= 0:
                messagebox.showwarning("选择无效", "所选骰子不能组成有效得分组合。")
                return

            self.turn_points += gained
            self.remaining_dice -= len(selected_values)
            self.log(
                f"玩家 {self.current_player} 拿走 {selected_values}，获得 {gained} 分，"
                f"本回合暂存 {self.turn_points} 分。"
            )

            if self.remaining_dice == 0:
                self.remaining_dice = 6
                self.log("本轮所有骰子都已拿走，下一掷恢复为 6 颗。")
                self.status_var.set(f"玩家 {self.current_player} 触发热骰，可以重新掷 6 颗骰子。")
            else:
                self.status_var.set(f"玩家 {self.current_player} 可以继续掷骰，或把本回合分数入账。")

            self.current_roll = []
            self.selected_indices = set()
            self.awaiting_selection = False
            self.selection_var.set("当前选择：已结算。")
            self.selection_label.configure(fg=self.SUCCESS)
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
                self.log(f"玩家 {player} 将 {self.turn_points} 分记入总分，总分来到 {self.scores[player]}。")
                if self.scores[player] >= self.target_score:
                    self.game_over = True
                    self.current_roll = []
                    self.selected_indices = set()
                    self.awaiting_selection = False
                    self.status_var.set(f"玩家 {player} 达到 {self.target_score} 分，赢得对局。")
                    self.selection_var.set("当前选择：对局已结束，点击“开始新游戏”可重新开始。")
                    self.refresh_summary()
                    self.set_button_states(roll=False, take=False, cont=False, bank=False)
                    self.render_dice()
                    self.log(f"玩家 {player} 获胜。")
                    messagebox.showinfo("游戏结束", f"玩家 {player} 率先达到 {self.target_score} 分，获胜。")
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
