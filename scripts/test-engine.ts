import {
  createInitialState,
  humanAction,
  botAction,
  nextHand,
  getLegalActions,
} from "../lib/engine.ts";
import type { GameState } from "../lib/engine.ts";

function playHand(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.stage !== "showdown" && !s.gameOver && guard < 500) {
    guard++;
    const p = s.players[s.turn];
    if (p.isHuman) {
      const legal = getLegalActions(s, 0);
      const action = legal.canCheck ? { type: "check" as const } : { type: "call" as const };
      s = humanAction(s, action);
    } else {
      s = botAction(s);
    }
  }
  return s;
}

const TOTAL = 3 * 200; // 3 players * 200 starting chips
let state = createInitialState();
let hands = 0;

for (let i = 0; i < 30 && !state.gameOver; i++) {
  state = playHand(state);
  const sum = state.players.reduce((a, p) => a + p.chips, 0) + state.pot;
  if (sum !== TOTAL) {
    console.error(`CHIP LEAK at hand ${state.handNumber}: sum=${sum} (expected ${TOTAL}) pot=${state.pot}`);
    process.exit(1);
  }
  hands++;
  console.log(
    `Hand ${state.handNumber}: ${state.message} | chips=[${state.players.map((p) => p.chips).join(",")}] pot=${state.pot}`,
  );
  if (!state.gameOver) state = nextHand(state);
}

console.log(`\nOK: ${hands} hands played, chips conserved every time. gameOver=${state.gameOver}`);
