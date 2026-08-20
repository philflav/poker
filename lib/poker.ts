// 7-card Texas Hold'em hand evaluator.
// A hand is scored as a comparable array [category, ...tiebreakers] so that
// lexicographic comparison decides the winner. Higher category wins; ties are
// broken by the descending tiebreaker ranks.

import type { Card } from "./deck.ts";

export type HandScore = number[];

const CATEGORY_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
];

export function categoryName(score: HandScore): string {
  return CATEGORY_NAMES[score[0]] ?? "Unknown";
}

// All 21 combinations of 5 cards drawn from 7.
function combinations5(cards: Card[]): Card[][] {
  const res: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            res.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return res;
}

function compareArrays(x: number[], y: number[]): number {
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const a = x[i] ?? 0;
    const b = y[i] ?? 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

// Score exactly 5 cards.
export function evaluate5(cards: Card[]): HandScore {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a); // descending
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  // Straight detection (including the wheel A-2-3-4-5).
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (ranks.join(",") === "14,5,4,3,2") straightHigh = 5;
  }

  const count = new Map<number, number>();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  const groups = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const counts = groups.map((g) => g[1]);
  const kickers = groups.map((g) => g[0]);

  if (straightHigh && isFlush) return [8, straightHigh];
  if (counts[0] === 4) return [7, kickers[0], kickers[1]];
  if (counts[0] === 3 && counts[1] === 2) return [6, kickers[0], kickers[1]];
  if (isFlush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (counts[0] === 3) return [3, kickers[0], kickers[1], kickers[2]];
  if (counts[0] === 2 && counts[1] === 2) return [2, kickers[0], kickers[1], kickers[2]];
  if (counts[0] === 2) return [1, kickers[0], kickers[1], kickers[2], kickers[3]];
  return [0, ...ranks];
}

// Best 5-card hand from any number (>=5) of cards.
export function evaluateBest(cards: Card[]): HandScore {
  let best: HandScore | null = null;
  for (const combo of combinations5(cards)) {
    const v = evaluate5(combo);
    if (!best || compareArrays(v, best) > 0) best = v;
  }
  return best as HandScore;
}

// Like evaluateBest, but also returns the actual 5 cards that form the best hand
// (used to highlight the winning combination at showdown).
export function bestCombo(cards: Card[]): { score: HandScore; five: Card[] } {
  let bestScore: HandScore | null = null;
  let bestFive: Card[] = [];
  for (const combo of combinations5(cards)) {
    const v = evaluate5(combo);
    if (!bestScore || compareArrays(v, bestScore) > 0) {
      bestScore = v;
      bestFive = combo;
    }
  }
  return { score: bestScore as HandScore, five: bestFive };
}

export function compareScore(a: HandScore, b: HandScore): number {
  return compareArrays(a, b);
}
