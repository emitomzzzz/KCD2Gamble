from functools import lru_cache

from .constants import STRAIGHT_PATTERNS, THREE_OF_A_KIND_BASE_SCORES


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
