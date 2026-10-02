// Win chance: play the rest of the game out many times with the board engine.
// Each run samples the opponent's unseen cards from the prediction model and
// shuffles your remaining deck, then both sides play greedily each turn:
// spend as much energy as possible, placing each card where it helps most.

import { buildBoard } from './engine.js';
import { locationEffect, boardModifiers } from './locations.js';

const DECK = 12;

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr, rand) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

// Weighted sample without replacement.
function sample(items, weights, k, rand) {
  const pool = items.map((x, i) => [x, Math.max(1e-6, weights[i])]);
  const out = [];
  while (out.length < k && pool.length) {
    let total = pool.reduce((s, p) => s + p[1], 0), x = rand() * total, i = 0;
    while (i < pool.length - 1 && (x -= pool[i][1]) > 0) i++;
    out.push(pool.splice(i, 1)[0][0]);
  }
  return out;
}

// Lane score from one side's view: who wins each lane, honouring scoring rules.
function laneMargins(board, lanes, turn) {
  return board.lanes.map((l, i) => {
    const fx = turn >= i + 1 ? locationEffect(lanes[i].loc) : null;
    if (fx?.scoring === 'ignored') return 0;
    if (fx?.scoring === 'lowest') return l.opp.power - l.me.power;
    if (fx?.scoring === 'cards' && l.me.cards !== l.opp.cards) return 100 * (l.me.cards - l.opp.cards);
    return l.me.power - l.opp.power;
  });
}
export function outcome(board, lanes, turn) {
  const m = laneMargins(board, lanes, turn);
  const won = m.filter((x) => x > 0).length, lost = m.filter((x) => x < 0).length;
  if (won !== lost) return won > lost ? 1 : 0;
  const total = board.lanes.reduce((s, l) => s + l.me.power - l.opp.power, 0);
  return total > 0 ? 1 : total < 0 ? 0 : 0.5;
}

// How good a board is for `side`: smooth sum of lane win chances.
function value(board, lanes, turn, side) {
  const m = laneMargins(board, lanes, turn).map((x) => (side === 'me' ? x : -x));
  const lanesWon = m.reduce((s, x) => s + Math.tanh(x / 6), 0);
  return lanesWon;
}

/**
 * opts: {
 *   events, lanes, turn, lastTurn, cards (Map), avgPower,
 *   oppRows: [{ id, pDeck }], oppSeen: number of their deck cards seen, oppHand,
 *   myHand: [{ id, power? }], myDeckLeft: [id], myHandSize,
 *   runs, seed   (energy, costs and draws come from the engine)
 * }
 * Returns { p, runs, lanes: [{ pWin }] }.
 */
export function winChance(opts) {
  const { events, lanes, turn, cards, avgPower, runs = 150, seed = 1 } = opts;
  const rand = rngFrom(seed);
  let wins = 0;
  const laneWins = [0, 0, 0];
  let uid = 0;
  const zc = (id, extra) => { const i = cards.get(id); return { id, cost: i ? i.cost : 0, power: i ? i.power : 0, ...extra }; };

  for (let r = 0; r < runs; r++) {
    const ev = events.slice();
    // Opponent: unseen deck sampled from the model; you: your remaining deck.
    const unseen = Math.max(0, DECK - opts.oppSeen);
    const oppCards = sample(opts.oppRows.map((x) => x.id), opts.oppRows.map((x) => x.pDeck), unseen, rand).map((id) => zc(id));
    const myDeck = shuffle(opts.myDeckLeft.map((id) => zc(id)), rand);
    const myHand = opts.myHand.length ? opts.myHand.map((x) => zc(x.id, x.power != null ? { power: x.power, created: true } : {})) : myDeck.splice(0, opts.myHandSize || 0);
    const oppHand = oppCards.splice(0, Math.min(opts.oppHand, oppCards.length));
    const zones = { me: { hand: myHand, deck: myDeck, discard: [] }, opp: { hand: oppHand, deck: oppCards, discard: [] } };
    const runSeed = Math.floor(rand() * 2 ** 31);
    // Same seed for every rebuild in a run, so random effects stay consistent.
    // makeGuess: the live board's "likely card" picks, so cards that hand/deck
    // effects put down earlier in the real game are on the board here too.
    const ctxFor = (t) => ({ cards, lanes, turn: t, avgPower, zones, zonesAt: events.length, zonesTurn: turn, rand: rngFrom(runSeed), guess: opts.makeGuess?.() });

    let lastTurn = opts.lastTurn;
    for (let t = turn; t <= lastTurn; t++) {
      // Both players commit blind: each plans against the board as it was
      // at the start of the turn plus their own plays, then all reveal.
      const startOfTurn = ev.slice();
      const board0 = buildBoard(startOfTurn, ctxFor(t));
      if (board0.lastTurn) lastTurn = Math.max(lastTurn, board0.lastTurn);
      const laneState = lanes.map((l, i) => ({ ...l, loc: board0.locs[i], mine: board0.lanes[i].me.power, theirs: board0.lanes[i].opp.power, myCards: board0.lanes[i].me.cards, oppCards: board0.lanes[i].opp.cards }));
      const mods = boardModifiers(laneState, t, avgPower);
      const planned = { me: [], opp: [] };
      for (const side of ['opp', 'me']) {
        const energy = board0.energyFor(side, t) + (side === 'me' ? mods.myEnergy : mods.oppEnergy) - board0.spent(side, t);
        const hand = board0.zones[side].hand.map((k) => ({ ...k, info: cards.get(k.id), cost: board0.costOf(side, k) })).filter((h) => h.info);
        const maxPlays = Math.min(mods.maxPlays, board0.maxPlays(side));
        // Candidate plays: the affordable subsets that use the most energy.
        // Each is placed greedily on the real board and the one leaving this
        // side best placed wins, so board-changing cards (Arnim Zola, Odin…)
        // are judged by what they do, not printed Power.
        const subsets = [];
        const n = Math.min(hand.length, 7);
        for (let mask = 1; mask < 1 << n; mask++) {
          let cost = 0, power = 0, k = 0;
          for (let i = 0; i < n; i++) if (mask & (1 << i)) { cost += hand[i].cost; power += hand[i].power; k++; }
          if (cost > energy || k > maxPlays) continue;
          subsets.push({ mask, score: cost * 10 + power });
        }
        subsets.sort((a, b) => b.score - a.score);
        const tryPlays = (picked) => {
          const plays = [];
          for (const h of picked.slice().sort((a, b) => b.cost - a.cost)) {
            let pick = null, pickVal = -Infinity;
            for (let lane = 0; lane < 3; lane++) {
              if (mods.forced.length && !mods.forced.includes(lane)) continue;
              const fx = t >= lane + 1 ? locationEffect(board0.locs[lane]) : null;
              if (fx?.blocked?.(h.info, { turn: t, reveal: lane + 1, side: {}, avgPower })) continue;
              if (!board0.canPlay(side, h.id, lane)) continue;
              const e = { t: 'play', uid: `s${++uid}`, side, id: h.id, lane, turn: t };
              const b = buildBoard([...startOfTurn, ...plays, e], ctxFor(t));
              if (b.lanes[lane][side].cards > 4) continue;
              const v = value(b, laneState, t, side);
              if (v > pickVal) { pickVal = v; pick = e; }
            }
            if (pick) plays.push(pick);
          }
          const v = plays.length ? value(buildBoard([...startOfTurn, ...plays], ctxFor(t)), laneState, t, side) : -Infinity;
          return { plays, v };
        };
        let bestPlan = { plays: [], v: -Infinity };
        for (const sub of subsets.slice(0, 5)) {
          const plan = tryPlays(hand.filter((_, i) => sub.mask & (1 << i)));
          if (plan.v > bestPlan.v + 1e-9) bestPlan = plan;
        }
        planned[side].push(...bestPlan.plays);
      }
      // Reveal order alternates by turn as a stand-in for "winner reveals first".
      const order = t % 2 ? ['opp', 'me'] : ['me', 'opp'];
      ev.push(...planned[order[0]], ...planned[order[1]]);
    }
    const final = buildBoard(ev, ctxFor(lastTurn + 1));
    const finalLanes = lanes.map((l, i) => ({ ...l, loc: final.locs[i] }));
    const res = outcome(final, finalLanes, lastTurn);
    wins += res;
    laneMargins(final, finalLanes, lastTurn).forEach((m, i) => { if (m > 0) laneWins[i]++; });
  }
  return { p: wins / runs, runs, lanes: laneWins.map((w) => ({ pWin: w / runs })) };
}

// Snap advice from a win chance.
export function snapAdvice(p) {
  if (p >= 0.7) return { call: 'Snap', tone: 'good', why: 'You win most playouts.' };
  if (p >= 0.55) return { call: 'Lean snap', tone: 'good', why: 'Ahead, but it can swing.' };
  if (p >= 0.4) return { call: 'Play it out', tone: 'warn', why: 'Close game: don’t snap, don’t panic.' };
  if (p >= 0.25) return { call: 'Don’t snap', tone: 'warn', why: 'Retreat if they snap.' };
  return { call: 'Retreat', tone: 'bad', why: 'You lose most playouts; save the cubes.' };
}
