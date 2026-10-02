// Board engine. The game is a log of events; the board is rebuilt by
// replaying them in order with card abilities (abilities.js) and location
// effects (locations.js) applied. Undo, edits and "what if" plays are all
// just a different event list.
//
// Events:
//   { t: 'play', uid, side, id, lane, turn }          a card played from hand (reveals)
//   { t: 'add', uid, side, id, lane, turn, power }    a created card (no reveal)
//   { t: 'move', uid, lane, turn }                     a player-chosen move
//   { t: 'buff', uid, delta }                          manual power correction
//   { t: 'destroy', uid, turn }
//   { t: 'log', uid, side, id, turn }                  opponent card seen but not placed
// side is 'me' or 'opp'; lane is 0..2.

import { ABILITIES } from './abilities.js';
import { locationEffect } from './locations.js';

export const other = (side) => (side === 'me' ? 'opp' : 'me');

export function buildBoard(events, { cards, lanes, turn, avgPower = () => 0 }) {
  const g = new Game(cards, lanes, avgPower);
  let curTurn = 1;
  for (const e of events) {
    while (curTurn < (e.turn ?? curTurn)) g.endOfTurn(curTurn++);
    g.turn = curTurn;
    g.apply(e);
  }
  while (curTurn < turn) g.endOfTurn(curTurn++);
  g.turn = turn;
  return g.finish();
}

class Game {
  constructor(cards, lanes, avgPower) {
    this.cardsById = cards;
    this.locs = lanes.map((l) => l.loc);
    this.avgPower = avgPower;
    this.board = [];          // card instances, including destroyed ones
    this.byUid = new Map();
    this.pending = [];        // "after you play your next card" effects
    this.lastPlayed = { me: null, opp: null };
    this.destroyedPower = 0;
    this.destroyedCount = 0;
    this.notes = [];
    this.turn = 1;
    this.eotAdj = [0, 1, 2].map(() => ({ me: 0, opp: 0 }));
    this.copySeq = 0;
  }

  // ---- queries -------------------------------------------------------------
  active() { return this.board.filter((c) => c.lane !== null && !c.gone); }
  at(lane, side) { return this.active().filter((c) => c.lane === lane && (!side || c.side === side)); }
  info(c) { return this.cardsById.get(c.id) || { cost: 0, power: 0, ability: '' }; }
  power(c) { return c.base + c.buff + (c.live || 0); }
  abilityOf(c) { return c.silenced ? null : ABILITIES[c.copiedText || c.id] || null; }
  hasText(c, re) { return !c.silenced && re.test(this.info(c).ability || ''); }
  locFx(lane) { return lane != null && this.turn >= lane + 1 ? locationEffect(this.locs[lane]) : null; }
  full(lane, side) { return this.at(lane, side).length >= 4; }

  // ---- mutations used by abilities ------------------------------------------
  buff(c, n) { if (c && !c.gone) c.buff += n; }
  setPower(c, n) { if (c && !c.gone) c.buff = n - c.base; }

  canDestroy(c) {
    if (this.locs[c.lane] === 'Wakanda' && this.turn >= c.lane + 1) return false;
    return !this.at(c.lane).some((x) => x.id === 'Armor' && !x.silenced);
  }
  destroy(c) {
    if (!c || c.gone || !this.canDestroy(c)) return false;
    const p = this.power(c);
    c.gone = 'destroyed';
    this.destroyedCount++;
    this.destroyedPower += Math.max(0, p);
    this.abilityOf(c)?.destroyed?.(this, c);
    return true;
  }

  move(c, lane, cause = 'ability') {
    if (!c || c.gone || lane == null || lane < 0 || lane > 2 || lane === c.lane) return false;
    if (this.full(lane, c.side)) return false;
    if (this.locs[c.lane] === 'IslandPrison' && this.turn >= c.lane + 1) return false;
    const from = c.lane;
    c.lane = lane;
    c.moves++;
    this.abilityOf(c)?.move?.(this, c, from, lane, cause);
    for (const k of this.at(lane)) if (k !== c && k.id === 'Kraven' && !k.silenced) k.buff += 2;
    const fx = this.locFx(lane);
    if (fx?.moveIn) fx.moveIn(this, c);
    return true;
  }

  // A new card instance in play without revealing (copies, tokens).
  spawn(side, id, lane, power, from) {
    if (lane == null || this.full(lane, side)) return null;
    const info = this.cardsById.get(id);
    const base = info ? info.power : 0;
    const c = { uid: `${from || 'x'}~${++this.copySeq}`, side, id, lane, base, buff: power == null ? 0 : power - base, moves: 0, turn: this.turn, created: true };
    this.board.push(c);
    this.byUid.set(c.uid, c);
    return c;
  }
  copy(c, lane) {
    const k = this.spawn(c.side, c.id, lane, null, c.uid);
    if (k) { k.buff = c.base + c.buff - k.base; k.copiedText = c.copiedText; }
    return k;
  }

  // How many times an On Reveal at this lane happens (Cosmo, Wong, Kamar-Taj...).
  revealTimes(c) {
    const here = this.at(c.lane);
    if (here.some((x) => x.id === 'Cosmo' && !x.silenced && x !== c)) return 0;
    const fx = this.locFx(c.lane);
    if (this.locs[c.lane] === 'Knowhere' && fx) return 0;
    let n = 1;
    for (const w of this.at(c.lane, c.side)) {
      if (w === c || w.silenced) continue;
      if (w.id === 'Wong' || w.copiedText === 'Wong') n += this.ongoingMult(w);
    }
    if (this.locs[c.lane] === 'KamarTaj' && fx) n += 1;
    return n;
  }
  // Onslaught: other Ongoing effects here apply an additional time.
  ongoingMult(c) {
    let m = 1;
    for (const o of this.at(c.lane, c.side)) if (o !== c && !o.silenced && o.id === 'Onslaught') m *= 2;
    return m;
  }
  reveal(c) {
    const ab = this.abilityOf(c);
    if (!ab?.reveal) return;
    const times = this.revealTimes(c);
    for (let i = 0; i < times && !c.gone; i++) this.runReveal(c, ab);
  }
  // Runs an On Reveal once. Repeats that trigger repeats (Odin, Grandmaster,
  // Absorbing Man…) are capped, like the game's own loop limit.
  runReveal(c, ab = this.abilityOf(c), as = c) {
    if (!ab?.reveal || (this.depth || 0) >= 6) return;
    this.depth = (this.depth || 0) + 1;
    try { ab.reveal(this, as); } finally { this.depth--; }
  }

  // ---- events --------------------------------------------------------------
  apply(e) {
    if (e.t === 'play' || e.t === 'add') {
      const info = this.cardsById.get(e.id);
      const base = info ? info.power : 0;
      const c = { uid: e.uid, side: e.side, id: e.id, lane: e.lane, base, buff: 0, moves: 0, turn: this.turn, created: e.t === 'add' };
      if (e.t === 'add' && e.power != null) c.buff = e.power - base;
      if (this.full(e.lane, e.side)) this.notes.push(`${info?.name || e.id}: that side was already full`);
      this.board.push(c);
      this.byUid.set(c.uid, c);
      if (e.t === 'add') return;
      // Location bonuses that stick to the card when it's played there.
      const fx = this.locFx(c.lane);
      if (fx?.power && !fx.ongoing && fx.kind === 'modelled') c.buff += fx.power(info || c, { turn: this.turn, side: { cards: this.at(c.lane, c.side).length - 1 }, avgPower: this.avgPower }, 1);
      for (const x of this.at(c.lane, c.side)) if (x !== c) this.abilityOf(x)?.allyPlayedHere?.(this, x, c);
      this.reveal(c);
      // "After you play your next card…" effects waiting on this side.
      const waiting = this.pending.filter((p) => p.side === c.side && p.src !== c.uid);
      this.pending = this.pending.filter((p) => !waiting.includes(p));
      for (const p of waiting) p.fn(this, c);
      this.lastPlayed[c.side] = c;
    } else if (e.t === 'log') {
      this.board.push({ uid: e.uid, side: e.side, id: e.id, lane: null, base: 0, buff: 0, moves: 0, turn: this.turn, logged: true });
    } else if (e.t === 'move') {
      this.move(this.byUid.get(e.uid), e.lane, 'player');
    } else if (e.t === 'buff') {
      const c = this.byUid.get(e.uid);
      if (c) c.buff += e.delta;
    } else if (e.t === 'destroy') {
      const c = this.byUid.get(e.uid);
      if (c && !c.gone) {
        // A player-entered destroy always happens (they saw it).
        const p = this.power(c);
        c.gone = 'destroyed';
        this.destroyedCount++;
        this.destroyedPower += Math.max(0, p);
        this.abilityOf(c)?.destroyed?.(this, c);
      }
    }
  }

  endOfTurn(t) {
    this.turn = t;
    for (const c of this.active()) this.abilityOf(c)?.eot?.(this, c);
    // Location end-of-turn effects work on side totals.
    this.computeLive();
    for (let lane = 0; lane < 3; lane++) {
      const fx = this.locFx(lane);
      if (!fx?.eot) continue;
      const side = (s) => ({ power: this.sideTotal(lane, s) + this.eotAdj[lane][s], cards: this.at(lane, s).length });
      const me = side('me'), opp = side('opp');
      const ctx = { turn: t, reveal: lane + 1 };
      for (const [s, mine, theirs] of [['me', me, opp], ['opp', opp, me]]) {
        const after = fx.eot(mine, theirs, ctx);
        if (after === 0 && mine.cards) for (const c of this.at(lane, s)) this.destroy(c);
        else this.eotAdj[lane][s] += after - mine.power;
      }
    }
  }

  // ---- ongoing effects and totals -----------------------------------------
  computeLive() {
    const act = this.active();
    for (const c of act) c.live = 0;
    for (const c of act) {
      const ab = this.abilityOf(c);
      if (!ab?.ongoing) continue;
      const mult = this.ongoingMult(c);
      for (let i = 0; i < mult; i++) ab.ongoing(this, c, (target, n) => { if (target && !target.gone) target.live += n; });
    }
    // "Cards here have …" locations apply while a card is there.
    for (let lane = 0; lane < 3; lane++) {
      const fx = this.locFx(lane);
      if (!fx?.power || !fx.ongoing) continue;
      for (const side of ['me', 'opp']) {
        const here = this.at(lane, side);
        for (const c of here) c.live += fx.power({ ...this.info(c), power: this.power(c) }, { turn: this.turn, side: { cards: 0 }, avgPower: this.avgPower }, here.length);
      }
    }
  }
  sideTotal(lane, side) {
    let total = this.at(lane, side).reduce((s, c) => s + this.power(c), 0);
    // Iron Man: your total Power is doubled here.
    for (const c of this.at(lane, side)) if ((c.id === 'IronMan' || c.copiedText === 'IronMan') && !c.silenced) total *= 2 ** this.ongoingMult(c);
    return total;
  }

  finish() {
    this.computeLive();
    const lanes = [0, 1, 2].map((lane) => ({
      me: { power: Math.round(this.sideTotal(lane, 'me') + this.eotAdj[lane].me), cards: this.at(lane, 'me').length },
      opp: { power: Math.round(this.sideTotal(lane, 'opp') + this.eotAdj[lane].opp), cards: this.at(lane, 'opp').length },
    }));
    return {
      cards: this.board,
      active: this.active(),
      lanes,
      power: (c) => Math.round(this.power(c)),
      destroyedCount: this.destroyedCount,
      notes: this.notes,
      pending: this.pending.map((p) => ({ side: p.side, label: p.label })),
    };
  }
}
