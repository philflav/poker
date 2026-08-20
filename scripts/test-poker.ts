import type { Card, Rank, Suit } from "../lib/deck.ts";
import { evaluate5, evaluateBest, bestCombo, compareScore } from "../lib/poker.ts";

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

// Straight flush beats lower straight flush.
const sfHigh = [c(5, "s"), c(6, "s"), c(7, "s"), c(8, "s"), c(9, "s")];
const sfLow = [c(4, "h"), c(5, "h"), c(6, "h"), c(7, "h"), c(8, "h")];
check("straight flush category", evaluate5(sfHigh)[0] === 8);
check("higher straight flush wins", compareScore(evaluate5(sfHigh), evaluate5(sfLow)) > 0);

// Four of a kind vs full house.
const quads = [c(9, "s"), c(9, "h"), c(9, "d"), c(9, "c"), c(13, "s")];
const boat = [c(9, "s"), c(9, "h"), c(9, "d"), c(13, "s"), c(13, "h")];
check("quads category 7", evaluate5(quads)[0] === 7);
check("full house category 6", evaluate5(boat)[0] === 6);
check("quads beat full house", compareScore(evaluate5(quads), evaluate5(boat)) > 0);

// Wheel straight A-2-3-4-5 has high card 5.
const wheel = [c(14, "s"), c(2, "h"), c(3, "d"), c(4, "c"), c(5, "s")];
check("wheel is a straight", evaluate5(wheel)[0] === 4);
check("wheel high card is 5", evaluate5(wheel)[1] === 5);

// Flush.
const flush = [c(2, "d"), c(5, "d"), c(7, "d"), c(9, "d"), c(11, "d")];
check("flush category 5", evaluate5(flush)[0] === 5);

// Two pair beats one pair.
const twoPair = [c(9, "s"), c(9, "h"), c(4, "d"), c(4, "c"), c(13, "s")];
const onePair = [c(9, "s"), c(9, "h"), c(3, "d"), c(6, "c"), c(13, "s")];
check("two pair category 2", evaluate5(twoPair)[0] === 2);
check("one pair category 1", evaluate5(onePair)[0] === 1);
check("two pair beats one pair", compareScore(evaluate5(twoPair), evaluate5(onePair)) > 0);

// bestCombo returns exactly 5 cards and matches best score on a 7-card hand.
const seven = [c(9, "s"), c(9, "h"), c(9, "d"), c(4, "c"), c(4, "s"), c(13, "h"), c(2, "c")];
const combo = bestCombo(seven);
check("bestCombo returns 5 cards", combo.five.length === 5);
check("bestCombo is full house", combo.score[0] === 6);
check("evaluateBest agrees with bestCombo", compareScore(evaluateBest(seven), combo.score) === 0);

console.log(`\npoker unit tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
