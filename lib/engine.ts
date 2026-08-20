// Texas Hold'em game engine (MVP): one human + 1..3 bots.
// Pure-ish module: functions take and return a GameState; the UI clones state
// with structuredClone before mutating so React sees a new reference.

import type { Card } from "./deck.ts";
import { createDeck, shuffle, shuffleWith, mulberry32 } from "./deck.ts";
import { bestCombo, categoryName, compareScore, evaluateBest } from "./poker.ts";
import { BOT_PROFILES, botDecision, winTaunt } from "./ai.ts";
import type { Difficulty } from "./ai.ts";

export type Stage = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  chips: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  bet: number; // chips committed this betting round
  contributed: number; // total chips committed this hand
  hasActed: boolean;
  lastAction: string;
  taunt: string;
}

export interface RevealWinner {
  id: number; // player id
  cards: Card[]; // the 5 cards that make their best hand
}

export interface GameState {
  players: Player[];
  community: Card[];
  deck: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  stage: Stage;
  dealer: number;
  turn: number;
  smallBlind: number;
  bigBlind: number;
  handNumber: number;
  difficulty: Difficulty;
  seed: number | null;
  blindLevel: number;
  handsThisLevel: number;
  sidePots: number[];
  revealWinners: RevealWinner[];
  message: string;
  log: string[];
  lastWinner?: { ids: number[]; amount: number; handName: string };
  gameOver?: boolean;
}

export interface PlayerAction {
  type: "fold" | "check" | "call" | "raise";
  amount?: number; // for raise: desired TOTAL bet this round
  taunt?: string;
}

export interface NewGameOptions {
  difficulty?: Difficulty;
  opponents?: number; // 1..3
  seed?: number | null;
}

export const START_CHIPS = 200;
export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;
export const HANDS_PER_LEVEL = 6;

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function log(state: GameState, line: string) {
  state.log = [line, ...state.log].slice(0, 30);
}

function firstActor(state: GameState): number {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (state.dealer + k) % n;
    const p = state.players[i];
    if (!p.folded && !p.allIn) return i;
  }
  return -1;
}

function nextActorAfter(state: GameState, from: number): number {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const p = state.players[i];
    if (!p.folded && !p.allIn && (!p.hasActed || p.bet < state.currentBet)) return i;
  }
  return -1;
}

function postBlind(state: GameState, idx: number, amount: number) {
  const p = state.players[idx];
  const pay = Math.min(amount, p.chips);
  p.chips -= pay;
  p.bet = pay;
  p.contributed += pay;
  state.pot += pay;
  if (p.chips === 0) p.allIn = true;
}

function blindsForLevel(level: number) {
  const sb = SMALL_BLIND * Math.pow(2, level - 1);
  return { sb, bb: sb * 2 };
}

function startHand(state: GameState) {
  state.handNumber += 1;
  state.revealWinners = [];
  state.sidePots = [];
  state.lastWinner = undefined;
  state.community = [];
  state.pot = 0;
  state.currentBet = 0;
  state.message = "";

  // Blind-level progression.
  state.handsThisLevel += 1;
  if (state.handsThisLevel > HANDS_PER_LEVEL) {
    state.handsThisLevel = 1;
    state.blindLevel += 1;
  }
  const { sb, bb } = blindsForLevel(state.blindLevel);
  state.smallBlind = sb;
  state.bigBlind = bb;
  state.minRaise = bb;

  // Players with no chips are out for this hand.
  for (const p of state.players) {
    p.hole = [];
    p.folded = p.chips <= 0;
    p.allIn = false;
    p.bet = 0;
    p.contributed = 0;
    p.hasActed = false;
    p.lastAction = "";
    p.taunt = "";
  }

  const livePlayers = state.players.filter((p) => p.chips > 0);
  if (livePlayers.length <= 1) {
    state.gameOver = true;
    state.stage = "showdown";
    const winner = livePlayers[0] ?? state.players[0];
    state.message = `${winner.name} wins the game with ${winner.chips} chips!`;
    return;
  }

  // Seeded shuffle for daily challenges; cryptographically fair otherwise.
  state.deck =
    state.seed != null
      ? shuffleWith(createDeck(), mulberry32((state.seed + state.handNumber * 7919) >>> 0))
      : shuffle(createDeck());

  for (const p of state.players) {
    if (p.chips > 0) {
      p.hole = [state.deck.pop()!, state.deck.pop()!];
    }
  }

  const n = state.players.length;
  // Assign the small/big blinds to the next two active (chips > 0) players after the dealer.
  // Busted players (chips <= 0) are skipped so a dead stack can never be dealt in or posted.
  let sbIdx = -1;
  let bbIdx = -1;
  for (let k = 1; k <= n && (sbIdx < 0 || bbIdx < 0); k++) {
    const i = (state.dealer + k) % n;
    if (state.players[i].chips > 0) {
      if (sbIdx < 0) sbIdx = i;
      else if (bbIdx < 0) bbIdx = i;
    }
  }
  if (sbIdx < 0) sbIdx = state.dealer;
  if (bbIdx < 0) bbIdx = state.dealer;
  postBlind(state, sbIdx, sb);
  postBlind(state, bbIdx, bb);
  state.currentBet = bb;
  // First actor preflop is the first eligible (active, not all-in) player after the big blind.
  let first = bbIdx;
  for (let k = 1; k <= n; k++) {
    const i = (bbIdx + k) % n;
    if (!state.players[i].folded && !state.players[i].allIn) {
      first = i;
      break;
    }
  }
  state.turn = first;
  state.stage = "preflop";
  log(state, `Hand ${state.handNumber} (Level ${state.blindLevel}, ${sb}/${bb}): blinds posted.`);
}

function advanceStage(state: GameState) {
  if (state.stage === "preflop") {
    state.community.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
    state.stage = "flop";
  } else if (state.stage === "flop") {
    state.community.push(state.deck.pop()!);
    state.stage = "turn";
  } else if (state.stage === "turn") {
    state.community.push(state.deck.pop()!);
    state.stage = "river";
  }

  for (const p of state.players) {
    p.bet = 0;
    p.hasActed = false;
  }
  state.currentBet = 0;
  state.turn = firstActor(state);
}

// Side-pot amounts derived from each player's total contribution.
function computePots(players: Player[]): number[] {
  const contributions = players.map((p) => p.contributed);
  const levels = [...new Set(contributions.filter((c) => c > 0))].sort((a, b) => a - b);
  let prev = 0;
  const pots: number[] = [];
  for (const lvl of levels) {
    let pot = 0;
    for (const c of contributions) if (c >= lvl) pot += lvl - prev;
    pots.push(pot);
    prev = lvl;
  }
  return pots;
}

function showdown(state: GameState) {
  state.stage = "showdown";
  const contributions = state.players.map((p) => p.contributed);
  const levels = [...new Set(contributions.filter((c) => c > 0))].sort((a, b) => a - b);

  let prev = 0;
  let topWinners: number[] = [];
  let topHandName = "";

  for (const lvl of levels) {
    let pot = 0;
    for (const c of contributions) if (c >= lvl) pot += lvl - prev;
    prev = lvl;

    const eligible = state.players.filter((p) => !p.folded && p.contributed >= lvl);
    let best = null as ReturnType<typeof evaluateBest> | null;
    let winners: number[] = [];
    for (const p of eligible) {
      const s = evaluateBest([...p.hole, ...state.community]);
      if (!best || compareScore(s, best) > 0) {
        best = s;
        winners = [p.id];
      } else if (compareScore(s, best) === 0) {
        winners.push(p.id);
      }
    }

    const share = Math.floor(pot / winners.length);
    for (const id of winners) {
      const wp = state.players.find((p) => p.id === id)!;
      wp.chips += share;
      if (!wp.isHuman) wp.taunt = winTaunt(id);
    }
    const remainder = pot - share * winners.length;
    if (remainder > 0 && winners.length) {
      state.players.find((p) => p.id === winners[0])!.chips += remainder;
    }

    // Capture the top (largest) pot's winners for reveal/highlight.
    topWinners = winners;
    if (winners.length) {
      const wp = state.players.find((p) => p.id === winners[0])!;
      topHandName = categoryName(bestCombo([...wp.hole, ...state.community]).score);
    }
  }

  state.sidePots = computePots(state.players);

  if (topWinners.length) {
    state.revealWinners = topWinners.map((id) => {
      const p = state.players.find((x) => x.id === id)!;
      return { id, cards: bestCombo([...p.hole, ...state.community]).five };
    });
    const names = topWinners.map((id) => state.players.find((p) => p.id === id)!.name).join(" & ");
    const topPot = state.sidePots[state.sidePots.length - 1] ?? 0;
    state.lastWinner = { ids: topWinners, amount: topPot, handName: topHandName };
    state.message = `${names} win ${topPot} with ${topHandName}.`;
    log(state, state.message);
  }

  state.pot = 0;
}

function awardFold(state: GameState, winner: Player) {
  winner.chips += state.pot;
  state.lastWinner = { ids: [winner.id], amount: state.pot, handName: "Fold" };
  state.pot = 0;
  state.sidePots = [];
  state.stage = "showdown";
  if (!winner.isHuman) winner.taunt = winTaunt(winner.id);
  state.message = `${winner.name} wins ${state.lastWinner.amount} (everyone folded).`;
  log(state, state.message);
}

function proceed(state: GameState) {
  const live = state.players.filter((p) => !p.folded);
  if (live.length === 1) {
    awardFold(state, live[0]);
    return;
  }
  if (state.stage === "river") {
    showdown(state);
    return;
  }
  advanceStage(state);
  const actors = state.players.filter((p) => !p.folded && !p.allIn);
  const needAct = actors.some((p) => !p.hasActed || p.bet < state.currentBet);
  if (actors.length > 0 && !needAct) {
    proceed(state); // everyone all-in: deal the next street automatically
  }
}

function applyAction(state: GameState, action: PlayerAction) {
  const p = state.players[state.turn];
  const toCall = state.currentBet - p.bet;

  if (action.type === "fold") {
    p.folded = true;
    p.hasActed = true;
    p.lastAction = "Fold";
    p.taunt = action.taunt ?? "";
    log(state, `${p.name} folds.`);
  } else if (action.type === "check") {
    if (toCall > 0) return; // illegal; ignore
    p.hasActed = true;
    p.lastAction = "Check";
    p.taunt = action.taunt ?? "";
    log(state, `${p.name} checks.`);
  } else if (action.type === "call") {
    const pay = Math.min(toCall, p.chips);
    p.chips -= pay;
    p.bet += pay;
    p.contributed += pay;
    state.pot += pay;
    p.hasActed = true;
    if (p.chips === 0) p.allIn = true;
    p.lastAction = pay === toCall ? "Call" : "All-in";
    p.taunt = action.taunt ?? "";
    log(state, `${p.name} calls ${pay}.`);
  } else if (action.type === "raise") {
    let total = action.amount ?? state.currentBet + state.minRaise;
    const maxTotal = p.bet + p.chips;
    total = Math.max(state.currentBet + state.minRaise, Math.min(total, maxTotal));
    const delta = total - p.bet;
    p.chips -= delta;
    p.bet = total;
    p.contributed += delta;
    state.pot += delta;
    if (p.chips === 0) p.allIn = true;
    p.hasActed = true;
    p.lastAction = p.allIn ? "All-in" : "Raise";
    p.taunt = action.taunt ?? "";
    if (total > state.currentBet) {
      const raiseSize = total - state.currentBet;
      state.currentBet = total;
      state.minRaise = Math.max(state.minRaise, raiseSize);
      for (const other of state.players) {
        if (other !== p && !other.folded && !other.allIn) other.hasActed = false;
      }
    }
    log(state, `${p.name} ${p.lastAction} to ${total}.`);
  }

  const live = state.players.filter((x) => !x.folded);
  if (live.length === 1) {
    awardFold(state, live[0]);
    return;
  }

  const actors = state.players.filter((x) => !x.folded && !x.allIn);
  const roundDone = actors.length === 0 || actors.every((x) => x.hasActed && x.bet === state.currentBet);

  if (!roundDone) {
    state.turn = nextActorAfter(state, state.turn);
    return;
  }
  proceed(state);
}

// --- Public API -----------------------------------------------------------

function buildPlayers(opponents: number): Player[] {
  const players: Player[] = [
    { id: 0, name: "You", isHuman: true, chips: START_CHIPS, hole: [], folded: false, allIn: false, bet: 0, contributed: 0, hasActed: false, lastAction: "", taunt: "" },
  ];
  for (let i = 0; i < opponents; i++) {
    const prof = BOT_PROFILES[i];
    players.push({
      id: i + 1,
      name: prof.name,
      isHuman: false,
      chips: START_CHIPS,
      hole: [],
      folded: false,
      allIn: false,
      bet: 0,
      contributed: 0,
      hasActed: false,
      lastAction: "",
      taunt: "",
    });
  }
  return players;
}

export function createInitialState(opts: NewGameOptions = {}): GameState {
  const difficulty = opts.difficulty ?? "normal";
  const opponents = Math.min(3, Math.max(1, opts.opponents ?? 2));
  const seed = opts.seed ?? null;
  const state: GameState = {
    players: buildPlayers(opponents),
    community: [],
    deck: [],
    pot: 0,
    currentBet: 0,
    minRaise: BIG_BLIND,
    stage: "preflop",
    dealer: 0,
    turn: 0,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    handNumber: 0,
    difficulty,
    seed,
    blindLevel: 1,
    handsThisLevel: 0,
    sidePots: [],
    revealWinners: [],
    message: "",
    log: [],
  };
  startHand(state);
  return state;
}

export function nextHand(state: GameState): GameState {
  const next = clone(state);
  const n = next.players.length;
  next.dealer = (next.dealer + 1) % n;
  startHand(next);
  return next;
}

export function humanAction(state: GameState, action: PlayerAction): GameState {
  const next = clone(state);
  if (next.players[next.turn]?.isHuman) applyAction(next, action);
  return next;
}

export function botAction(state: GameState): GameState {
  const next = clone(state);
  const p = next.players[next.turn];
  if (!p || p.isHuman || p.folded || p.allIn) return next;
  const toCall = next.currentBet - p.bet;
  const canRaise = !p.allIn && p.chips > toCall;
  const decision = botDecision(p.id, p.hole, next.community, toCall, next.minRaise, canRaise, next.difficulty);
  applyAction(next, decision);
  return next;
}

export interface LegalActions {
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export function getLegalActions(state: GameState, idx: number): LegalActions {
  const p = state.players[idx];
  const toCall = state.currentBet - p.bet;
  return {
    canCheck: toCall <= 0,
    canCall: toCall > 0 && p.chips > 0,
    callAmount: Math.min(toCall, p.chips),
    canRaise: !p.allIn && p.chips > toCall,
    minRaiseTo: state.currentBet + state.minRaise,
    maxRaiseTo: p.bet + p.chips,
  };
}

// Helper for the UI: how many hands remain in the current blind level.
export function handsUntilNextLevel(state: GameState): number {
  return Math.max(0, HANDS_PER_LEVEL - state.handsThisLevel + 1);
}
