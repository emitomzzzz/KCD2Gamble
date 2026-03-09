import unittest

from dice_game import has_scoring_option, score_selection


class ScoreSelectionTests(unittest.TestCase):
    def test_single_one_scores(self):
        self.assertEqual(score_selection([1]), 100)

    def test_single_five_scores(self):
        self.assertEqual(score_selection([5]), 50)

    def test_three_ones_scores(self):
        self.assertEqual(score_selection([1, 1, 1]), 1000)

    def test_three_sixes_scores(self):
        self.assertEqual(score_selection([6, 6, 6]), 600)

    def test_four_of_a_kind_scores(self):
        self.assertEqual(score_selection([2, 2, 2, 2]), 400)

    def test_straight_scores(self):
        self.assertEqual(score_selection([1, 2, 3, 4, 5, 6]), 1500)

    def test_three_pairs_score(self):
        self.assertEqual(score_selection([1, 1, 2, 2, 3, 3]), 1500)

    def test_two_triplets_score(self):
        self.assertEqual(score_selection([2, 2, 2, 5, 5, 5]), 2500)

    def test_invalid_pair_scores_zero(self):
        self.assertEqual(score_selection([2, 2]), 0)

    def test_mixed_selection_scores(self):
        self.assertEqual(score_selection([1, 1, 1, 5]), 1050)

    def test_dead_roll_has_no_scoring_option(self):
        self.assertFalse(has_scoring_option([2, 2, 3, 3, 4, 6]))

    def test_roll_with_single_one_can_score(self):
        self.assertTrue(has_scoring_option([1, 2, 3, 4, 6, 6]))


if __name__ == "__main__":
    unittest.main()
