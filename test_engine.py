import unittest

from dicegame.engine import DiceGameEngine, GamePhase


class SequenceRng:
    def __init__(self, values):
        self.values = list(values)

    def randint(self, _start, _end):
        if not self.values:
            raise AssertionError("No more predetermined dice values are available.")
        return self.values.pop(0)


class DiceGameEngineTests(unittest.TestCase):
    def test_roll_with_scoring_option_enters_selection_phase(self):
        engine = DiceGameEngine(rng=SequenceRng([1, 2, 3, 4, 5, 6]))

        result = engine.roll()

        self.assertEqual(result.dice, (1, 2, 3, 4, 5, 6))
        self.assertTrue(result.has_scoring_option)
        self.assertEqual(engine.state.phase, GamePhase.AWAITING_SELECTION)

    def test_preview_selection_reports_invalid_subset_without_changing_phase(self):
        engine = DiceGameEngine(rng=SequenceRng([1, 2, 2, 3, 4, 6]))
        engine.roll()

        preview = engine.preview_selection([1, 2])

        self.assertEqual(preview.dice, (2, 2))
        self.assertEqual(preview.points, 0)
        self.assertFalse(preview.is_valid)
        self.assertEqual(engine.state.phase, GamePhase.AWAITING_SELECTION)

    def test_take_selection_sets_hot_dice_when_all_dice_are_scored(self):
        engine = DiceGameEngine(rng=SequenceRng([1, 1, 1, 1, 1, 1]))
        engine.roll()

        result = engine.take_selection([0, 1, 2, 3, 4, 5])

        self.assertEqual(result.points_gained, 8000)
        self.assertTrue(result.hot_dice)
        self.assertEqual(engine.state.turn_points, 8000)
        self.assertEqual(engine.state.remaining_dice, 6)
        self.assertEqual(engine.state.current_roll, ())
        self.assertEqual(engine.state.phase, GamePhase.CAN_BANK_OR_CONTINUE)

    def test_continue_turn_rolls_only_remaining_dice(self):
        engine = DiceGameEngine(rng=SequenceRng([1, 5, 2, 2, 3, 4, 1, 1, 1, 5]))
        engine.roll()
        engine.take_selection([0, 1])

        result = engine.continue_turn()

        self.assertEqual(result.dice, (1, 1, 1, 5))
        self.assertTrue(result.has_scoring_option)
        self.assertEqual(engine.state.remaining_dice, 4)
        self.assertEqual(engine.state.phase, GamePhase.AWAITING_SELECTION)

    def test_finish_farkle_turn_advances_to_next_player_and_resets_turn_state(self):
        engine = DiceGameEngine(rng=SequenceRng([2, 2, 3, 3, 4, 6]))

        result = engine.roll()
        transition = engine.finish_farkle_turn()

        self.assertFalse(result.has_scoring_option)
        self.assertEqual(transition.player, "A")
        self.assertEqual(transition.next_player, "B")
        self.assertEqual(engine.state.current_player, "B")
        self.assertEqual(engine.state.turn_points, 0)
        self.assertEqual(engine.state.remaining_dice, 6)
        self.assertEqual(engine.state.current_roll, ())
        self.assertEqual(engine.state.phase, GamePhase.READY_TO_ROLL)

    def test_bank_turn_advances_after_non_winning_score(self):
        engine = DiceGameEngine(target_score=5000, rng=SequenceRng([1, 1, 1, 5, 2, 3]))
        engine.roll()
        engine.take_selection([0, 1, 2, 3])

        result = engine.bank_turn()

        self.assertFalse(result.won)
        self.assertEqual(result.banked_points, 1050)
        self.assertEqual(result.total_score, 1050)
        self.assertEqual(result.next_player, "B")
        self.assertEqual(engine.state.scores["A"], 1050)
        self.assertEqual(engine.state.current_player, "B")
        self.assertEqual(engine.state.turn_points, 0)
        self.assertEqual(engine.state.phase, GamePhase.READY_TO_ROLL)

    def test_bank_turn_to_win_sets_game_over_without_clearing_turn_points(self):
        engine = DiceGameEngine(target_score=500, rng=SequenceRng([1, 1, 1, 5, 2, 3]))
        engine.roll()
        engine.take_selection([0, 1, 2, 3])

        result = engine.bank_turn()

        self.assertTrue(result.won)
        self.assertEqual(result.next_player, None)
        self.assertEqual(engine.state.winner, "A")
        self.assertEqual(engine.state.current_player, "A")
        self.assertEqual(engine.state.turn_points, 1050)
        self.assertEqual(engine.state.current_roll, ())
        self.assertEqual(engine.state.phase, GamePhase.GAME_OVER)


if __name__ == "__main__":
    unittest.main()
