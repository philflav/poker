import {
  createInitialState,
  getLegalActions,
  humanAction,
  botAction,
  nextHand,
} from "../lib/engine.ts";
import type { GameState } from "../lib/engine.ts";
import type { Difficulty } from "../lib/ai.ts";

// A fixed, naive human policy (always check/call) vs bots at each difficulty.
// Higher difficulty should leave the human with fewer chips on average.
function runTrial(difficulty: Difficulty, maxHands: number): number {
  let state: GameState = createInitialState({ difficulty, opponents: 2 });
  let hands = 0;
  while (hands < maxHands && !state.gameOver) {
    let actions = 0;
    while (state.stage !== "showdown" && !state.gameOver) {
      actions++;
      if (actions > 5000) {
        console.error(`STUCK at hand ${hands}, stage ${state.stage}, turn ${state.turn}: ${JSON.stringify(state.players.map((p) => ({ id: p.id, folded: p.folded, allIn: p.allIn, bet: p.bet, chips: p.chips, hasActed: p.hasActed, last: p.lastAction })))}`);
        process.exit(2);
      }
      const p = state.players[state.turn];
      if (p.isHuman) {
        const legal = getLegalActions(state, 0);
        state = humanAction(state, legal.canCheck ? { type: "check" } : { type: "call" });
      } else {
        state = botAction(state);
      }
    }
    hands++;
    state = nextHand(state);
  }
  return state.players[0].chips;
}

function avg(arr: number[]): number {
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

const TRIALS = 6;
const MAX_HANDS = 30;
const difficulties: Difficulty[] = ["easy", "normal", "hard"];

console.log(`Difficulty win-rate sim (naive always-call human, ${TRIALS} trials, up to ${MAX_HANDS} hands each):\n`);
for (const d of difficulties) {
  const results: number[] = [];
  for (let i = 0; i < TRIALS; i++) results.push(runTrial(d, MAX_HANDS));
  const survived = results.filter((c) => c > 0).length;
  console.log(
    `  ${d.padEnd(7)} -> avg human chips: ${avg(results).toString().padStart(4)} | survived ${survived}/${TRIALS} trials`,
  );
}
console.log("\nExpectation: human avg chips and survival should DECREASE as difficulty rises.");
