"use client";

import { useEffect, useRef, useState } from "react";
import CardView from "@/components/CardView";
import {
  createInitialState,
  getLegalActions,
  handsUntilNextLevel,
  humanAction,
  botAction,
  nextHand,
} from "@/lib/engine";
import type { GameState, PlayerAction, NewGameOptions } from "@/lib/engine";
import type { Card } from "@/lib/deck.ts";
import { estimateStrength } from "@/lib/ai.ts";
import type { Difficulty } from "@/lib/ai.ts";

const SAVE_KEY = "poker-state-v1";
const ACH_KEY = "poker-achievements-v1";
const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

function todaySeed(): number {
  const d = new Date();
  return Number(`${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}`);
}

// ---- Sounds (Web Audio, lazy + muteable) ----
let audioCtx: AudioContext | null = null;
function unlockAudio() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function tone(freq: number, dur: number, type: OscillatorType = "sine") {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = 0.05;
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.stop(audioCtx.currentTime + dur);
}

interface ReplayHand {
  community: Card[];
  seats: { name: string; hole: Card[]; folded: boolean }[];
  winnerNames: string;
  handName: string;
  amount: number;
}

const ACHIEVEMENTS: { id: string; label: string; desc: string }[] = [
  { id: "first", label: "First Blood", desc: "Win your first hand." },
  { id: "highcard", label: "High Card Hero", desc: "Win with just a high card." },
  { id: "flush", label: "Flush Found", desc: "Win with a Flush or better." },
  { id: "buster", label: "Bot Buster", desc: "Bust an opponent to 0 chips." },
  { id: "daily", label: "Daily Devotion", desc: "Play a Daily Challenge." },
  { id: "level3", label: "Level Up", desc: "Reach blind Level 3." },
];

function loadAchievements(): Set<string> {
  try {
    const raw = localStorage.getItem(ACH_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}

export default function Home() {
  const [state, setState] = useState<GameState | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [opponents, setOpponents] = useState(2);
  const [raise, setRaise] = useState(20);
  const [muted, setMuted] = useState(false);
  const [achievements, setAchievements] = useState<Set<string>>(new Set());
  const [showAch, setShowAch] = useState(false);
  const [replay, setReplay] = useState<ReplayHand | null>(null);
  const [showReplay, setShowReplay] = useState(false);

  const prevCommunity = useRef(0);
  const prevPot = useRef(0);
  const prevStage = useRef<string>("");
  const processedHand = useRef(0);

  // Load bankroll + achievements on mount.
  useEffect(() => {
    setAchievements(loadAchievements());
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw) as GameState;
        if (s && Array.isArray(s.players) && s.players.length >= 2) {
          // Normalize saves from older builds that lacked newer fields.
          s.revealWinners = s.revealWinners ?? [];
          s.sidePots = s.sidePots ?? [];
          s.difficulty = s.difficulty ?? "normal";
          setState(s);
          setDifficulty(s.difficulty);
          setOpponents(s.players.length - 1);
          return;
        }
      } catch {
        /* ignore */
      }
    }
    setState(createInitialState({ difficulty, opponents }));
  }, []);

  // Persist bankroll.
  useEffect(() => {
    if (state) localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }, [state]);

  // Bot auto-play, with random "tell" delays.
  useEffect(() => {
    if (!state || state.gameOver || state.stage === "showdown") return;
    const p = state.players[state.turn];
    if (p && !p.isHuman && !p.folded && !p.allIn) {
      const r = Math.random();
      const delay = r < 0.15 ? 250 : r > 0.85 ? 1600 : 800; // snap / hesitate / normal
      const t = setTimeout(() => setState(botAction(state)), delay);
      return () => clearTimeout(t);
    }
  }, [state]);

  // Sound effects based on state transitions.
  useEffect(() => {
    if (!state || muted) return;
    if (state.community.length > prevCommunity.current) tone(440, 0.08);
    if (state.pot > prevPot.current) tone(200, 0.05, "square");
    if (state.stage === "showdown" && prevStage.current !== "showdown") {
      tone(660, 0.25);
      setTimeout(() => tone(880, 0.3), 120);
    }
    prevCommunity.current = state.community.length;
    prevPot.current = state.pot;
    prevStage.current = state.stage;
  }, [state, muted]);

  // Achievements, processed once per completed hand.
  useEffect(() => {
    if (!state || state.stage !== "showdown") return;
    if (state.handNumber === processedHand.current) return;
    processedHand.current = state.handNumber;

    const earned = new Set(achievements);
    const youWon = state.lastWinner?.ids.includes(0);
    if (youWon) {
      earned.add("first");
      if (state.lastWinner?.handName === "High Card") earned.add("highcard");
      if (["Flush", "Full House", "Four of a Kind", "Straight Flush"].includes(state.lastWinner?.handName ?? ""))
        earned.add("flush");
    }
    if (state.players.some((p) => !p.isHuman && p.chips <= 0)) earned.add("buster");
    if (state.blindLevel >= 3) earned.add("level3");
    if (state.seed != null) earned.add("daily");

    if (earned.size !== achievements.size) {
      setAchievements(earned);
      localStorage.setItem(ACH_KEY, JSON.stringify([...earned]));
    }
  }, [state, achievements]);

  if (!state) return <div className="page"><div className="title">Loading…</div></div>;

  const legal = getLegalActions(state, 0);
  const isYourTurn =
    !state.gameOver && state.stage !== "showdown" && state.players[state.turn]?.isHuman === true;
  const activeBot = state.players[state.turn];
  const thinking = !state.gameOver && state.stage !== "showdown" && activeBot && !activeBot.isHuman && !activeBot.folded && !activeBot.allIn;

  // Winning-card highlight set for showdown.
  const winningKeys = new Set<string>();
  const revealWinners = state.revealWinners ?? [];
  if (state.stage === "showdown") {
    for (const w of revealWinners) {
      for (const c of w.cards) winningKeys.add(`${c.rank}${c.suit}`);
    }
  }
  const isWinning = (c: Card) => winningKeys.has(`${c.rank}${c.suit}`);

  function newGame(opts: NewGameOptions) {
    unlockAudio();
    const d = opts.difficulty ?? difficulty;
    const o = opts.opponents ?? opponents;
    setDifficulty(d);
    setOpponents(o);
    setState(createInitialState({ difficulty: d, opponents: o, seed: opts.seed ?? null }));
  }

  function act(action: PlayerAction) {
    unlockAudio();
    setState((s) => (s ? humanAction(s, action) : s));
  }

  function startNext() {
    if (!state) return;
    // Capture replay snapshot before advancing.
    if (state.stage === "showdown" && state.lastWinner) {
      setReplay({
        community: state.community,
        seats: state.players.map((p) => ({ name: p.name, hole: p.hole, folded: p.folded })),
        winnerNames: state.lastWinner.ids.map((id) => state.players.find((p) => p.id === id)!.name).join(" & "),
        handName: state.lastWinner.handName,
        amount: state.lastWinner.amount,
      });
    }
    setState((s) => (s ? nextHand(s) : s));
  }

  // Raise preset helpers (raise-to amounts, clamped).
  const clampRaise = (to: number) => Math.max(legal.minRaiseTo, Math.min(to, legal.maxRaiseTo));
  const doRaise = (to: number) => act({ type: "raise", amount: clampRaise(to) });

  const potPresets = [
    { label: "½ Pot", to: state.currentBet + Math.floor(state.pot / 2) },
    { label: "Pot", to: state.currentBet + state.pot },
    { label: "2× Pot", to: state.currentBet + state.pot * 2 },
  ];

  return (
    <div className="page">
      <div className="title">♠ HOLD&apos;EM — You vs the Bots ♥</div>

      <div className="topbar">
        <div className="group">
          {DIFFICULTIES.map((d) => (
            <button key={d} className={difficulty === d ? "primary" : ""} onClick={() => newGame({ difficulty: d })}>
              {d[0].toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
        <div className="group">
          {[1, 2, 3].map((n) => (
            <button key={n} className={opponents === n ? "primary" : ""} onClick={() => newGame({ opponents: n })}>
              {n} opp
            </button>
          ))}
        </div>
        <div className="group">
          <button onClick={() => newGame({ seed: todaySeed() })}>Daily</button>
          <button onClick={() => setMuted((m) => !m)}>{muted ? "🔇" : "🔊"}</button>
          <button onClick={() => setShowAch(true)}>🏆 {achievements.size}</button>
          <button onClick={() => setShowReplay(true)} disabled={!replay}>↺ Replay</button>
        </div>
      </div>

      <div className="meta-row">
        <span>Blind Level {state.blindLevel} ({state.smallBlind}/{state.bigBlind})</span>
        <span>Next level in {handsUntilNextLevel(state)} hands</span>
        {state.seed != null && <span>Daily #{state.seed}</span>}
      </div>

      <div className="table">
        <div className="pot">
          POT: {state.pot}
          {state.sidePots && state.sidePots.length > 1 && (
            <span className="sidepots"> · side pots: {state.sidePots.join(" / ")}</span>
          )}
        </div>

        <div className="community">
          {state.community.length === 0 ? (
            <span style={{ opacity: 0.5 }}>Dealing soon…</span>
          ) : (
            state.community.map((c, i) => <CardView key={i} card={c} winning={isWinning(c)} />)
          )}
        </div>

        <div className="seats">
          {state.players.map((p, i) => (
            <div
              key={p.id}
              className={[
                "seat",
                state.turn === i && state.stage !== "showdown" ? "active" : "",
                p.folded ? "folded" : "",
                state.dealer === i ? "dealer" : "",
                state.stage === "showdown" && revealWinners.some((w) => w.id === p.id) ? "winner" : "",
              ].join(" ")}
            >
              {p.taunt && <div className="taunt">{p.taunt}</div>}
              <div className="name">
                {p.name}
                {p.isHuman ? "" : " (bot)"}
                {thinking && state.turn === i && <span className="thinking"> 🤔</span>}
              </div>
              <div className="meta">Chips: {p.chips} · Bet: {p.bet}{p.allIn ? " · ALL-IN" : ""}</div>
              {!p.isHuman && p.hole.length === 2 && (
                <div className="strength" title="Bot hand strength">
                  <div className="strength-fill" style={{ width: `${Math.round(estimateStrength(p.hole, state.community) * 100)}%` }} />
                </div>
              )}
              <div className="action">{p.lastAction}</div>
              <div className="hole">
                {p.hole.length === 0 ? (
                  <CardView faceDown small />
                ) : p.isHuman || state.stage === "showdown" ? (
                  p.hole.map((c, j) => <CardView key={j} card={c} small winning={isWinning(c)} />)
                ) : (
                  <>
                    <CardView faceDown small />
                    <CardView faceDown small />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="message">{state.message}</div>

      <div className="controls">
        {state.gameOver ? (
          <button className="primary" onClick={() => newGame({})}>New Game</button>
        ) : state.stage === "showdown" ? (
          <button className="primary" onClick={startNext}>Next Hand</button>
        ) : isYourTurn ? (
          <>
            <button onClick={() => act({ type: "fold" })}>Fold</button>
            {legal.canCheck ? (
              <button onClick={() => act({ type: "check" })}>Check</button>
            ) : (
              <button onClick={() => act({ type: "call" })}>Call {legal.callAmount}</button>
            )}
            {legal.canRaise && (
              <>
                {potPresets.map((pr) => (
                  <button key={pr.label} onClick={() => doRaise(pr.to)}>
                    {pr.label}
                  </button>
                ))}
                <button className="primary" onClick={() => doRaise(legal.maxRaiseTo)}>All-in</button>
                <div className="raise-box">
                  <span>Raise to</span>
                  <input
                    type="number"
                    value={raise}
                    min={legal.minRaiseTo}
                    max={legal.maxRaiseTo}
                    onChange={(e) => setRaise(Number(e.target.value))}
                  />
                  <button className="primary" onClick={() => doRaise(raise)}>Raise</button>
                </div>
              </>
            )}
          </>
        ) : (
          <span style={{ opacity: 0.7 }}>Waiting for {state.players[state.turn]?.name}…</span>
        )}
      </div>

      <ul className="log">
        {state.log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      {showAch && (
        <div className="overlay" onClick={() => setShowAch(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>Achievements ({achievements.size}/{ACHIEVEMENTS.length})</h2>
            {ACHIEVEMENTS.map((a) => (
              <div key={a.id} className={achievements.has(a.id) ? "ach earned" : "ach"}>
                <strong>{achievements.has(a.id) ? "✅" : "⬜"} {a.label}</strong>
                <div className="ach-desc">{a.desc}</div>
              </div>
            ))}
            <button className="primary" onClick={() => setShowAch(false)}>Close</button>
          </div>
        </div>
      )}

      {showReplay && replay && (
        <div className="overlay" onClick={() => setShowReplay(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>Last Hand Replay</h2>
            <p>{replay.winnerNames} won {replay.amount} with {replay.handName}.</p>
            <div className="community">
              {replay.community.map((c, i) => <CardView key={i} card={c} small />)}
            </div>
            {replay.seats.map((s, i) => (
              <div key={i} className="replay-seat">
                <strong>{s.name}</strong>
                <div className="hole">
                  {s.folded ? <CardView faceDown small /> : s.hole.map((c, j) => <CardView key={j} card={c} small />)}
                </div>
              </div>
            ))}
            <button className="primary" onClick={() => setShowReplay(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
