// Simple, readable bot opponents for the MVP, now with personalities, taunts,
// difficulty levels, and a strength estimate for the UI.

import type { Card } from "./deck.ts";
import { evaluateBest } from "./poker.ts";

export type Difficulty = "easy" | "normal" | "hard";

export interface BotDecision {
  type: "fold" | "check" | "call" | "raise";
  amount?: number; // total bet this round (for raise)
  taunt?: string;
}

export interface BotProfile {
  name: string;
  blurb: string;
  taunts: {
    raise: string[];
    call: string[];
    fold: string[];
    win: string[];
  };
}

// Indexed by opponent position (player id - 1). Up to 3 opponents supported.
export const BOT_PROFILES: BotProfile[] = [
  {
    name: "Rook",
    blurb: "Aggressive bully who loves to raise.",
    taunts: {
      raise: ["Feel the pressure?", "Raise — because I can.", "Scared yet?"],
      call: ["I'll see you.", "Lucky again, are we?"],
      fold: ["Not worth my chips.", "I'll get you later."],
      win: ["Too easy.", "Pay up, rookie."],
    },
  },
  {
    name: "Vera",
    blurb: "Patient and mathematical — never tilts.",
    taunts: {
      raise: ["The math says raise.", "I've got the odds."],
      call: ["Let's see the turn.", "Calling — politely."],
      fold: ["Disciplined fold.", "Not this time."],
      win: ["Calculated.", "As expected."],
    },
  },
  {
    name: "Cody",
    blurb: "Loose cannon — unpredictable and splashy.",
    taunts: {
      raise: ["YOLO raise!", "Gotta keep it spicy."],
      call: ["I'm curious.", "Just one more street."],
      fold: ["Boring. I'm out.", "Recycle that hand."],
      win: ["Vibes were immaculate.", "Told ya!"],
    },
  },
];

// Per-difficulty aggression multiplier applied to hand strength.
const AGGRO: Record<Difficulty, number> = { easy: 0.7, normal: 1, hard: 1.35 };

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function preflopStrength(hole: Card[]): number {
  const [a, b] = hole;
  let s = 0;
  const high = Math.max(a.rank, b.rank);
  const low = Math.min(a.rank, b.rank);
  if (a.rank === b.rank) s += 0.5 + (high - 2) / 24;
  else s += (high - 2) / 24 * 0.6 + (low - 2) / 24 * 0.3;
  if (a.suit === b.suit) s += 0.05;
  if (high - low <= 4 && high >= 10) s += 0.05;
  return Math.min(1, s);
}

function postflopStrength(hole: Card[], community: Card[]): number {
  const score = evaluateBest([...hole, ...community]);
  const cat = score[0];
  return Math.min(0.95, 0.15 + cat * 0.1);
}

// Public strength estimate (0..1) for the UI meter.
export function estimateStrength(hole: Card[], community: Card[]): number {
  if (hole.length < 2) return 0;
  return community.length === 0 ? preflopStrength(hole) : postflopStrength(hole, community);
}

export function winTaunt(playerId: number): string {
  const p = BOT_PROFILES[playerId - 1];
  return p ? pick(p.taunts.win) : "";
}

export function botDecision(
  playerId: number,
  hole: Card[],
  community: Card[],
  toCall: number,
  minRaise: number,
  canRaise: boolean,
  difficulty: Difficulty = "normal",
): BotDecision {
  const profile = BOT_PROFILES[playerId - 1];
  const taunts = profile?.taunts;
  const strength = community.length === 0 ? preflopStrength(hole) : postflopStrength(hole, community);
  const aggro = AGGRO[difficulty];
  const r = Math.random();
  const s = Math.min(1, strength * aggro);

  // No bet to call -> check or sometimes raise.
  if (toCall <= 0) {
    if (s > 0.55 && canRaise && r < 0.5 * aggro) {
      return { type: "raise", amount: minRaise * 2, taunt: taunts ? pick(taunts.raise) : undefined };
    }
    return { type: "check", taunt: taunts ? pick(taunts.call) : undefined };
  }

  // A bet to call.
  if (s < 0.3 && r > 0.3) {
    return { type: "fold", taunt: taunts ? pick(taunts.fold) : undefined };
  }

  if (s > 0.6 && canRaise && r < 0.7) {
    return { type: "raise", amount: minRaise * 2, taunt: taunts ? pick(taunts.raise) : undefined };
  }

  if (s > 0.45 && canRaise && r < 0.25) {
    return { type: "raise", amount: minRaise, taunt: taunts ? pick(taunts.raise) : undefined };
  }
  return { type: "call", taunt: taunts ? pick(taunts.call) : undefined };
}
