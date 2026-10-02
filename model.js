// Snap Scout prediction model. Plain ES module: used by index.html and by
// scripts/backtest.mjs, so the backtest measures exactly what the app runs.

export const DECK_SIZE = 12;

// Tuned with `node scripts/backtest.mjs --tune` (validation split, Oct 2026 data).
export const DEFAULT_PARAMS = {
  smoothing: 50,      // pseudo-games of baseline frequency added to every P(card | seen card)
  damping: 0.5,       // evidence from n seen cards is scaled by 1 / n^damping (seen cards are correlated)
  maxMismatch: 3,     // soft deck match: most seen cards a deck may be missing
  mismatchPenalty: 3, // each missing seen card multiplies a deck's weight by e^-penalty
  matchMax: 0.85,     // largest share the deck-match signal can take in the blend
  matchHalfGames: 100, // matched game mass at which the blend reaches ~63% of matchMax
};

const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clampP = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));

export class Model {
  // ids: card defIds indexed by deck entries; decks: [[games, ...12 indices], ...]
  constructor(ids, decks, params = {}) {
    this.ids = ids;
    this.index = new Map(ids.map((id, i) => [id, i]));
    this.decks = decks;
    this.params = { ...DEFAULT_PARAMS, ...params };
    const n = ids.length;
    this.cardW = new Float64Array(n);
    this.pairW = new Float64Array(n * n);
    let total = 0;
    for (const d of decks) {
      const w = d[0];
      total += w;
      for (let i = 1; i <= DECK_SIZE; i++) {
        const a = d[i];
        this.cardW[a] += w;
        for (let j = 1; j <= DECK_SIZE; j++) if (j !== i) this.pairW[a * n + d[j]] += w;
      }
    }
    this.total = total;
    this.base = Array.from(this.cardW, (w) => clampP(w / total));
  }

  // Baseline: P(card in a random deck), weighted by play count.
  popularity(seen) {
    const s = new Set(seen);
    return this.ids.map((_, c) => (s.has(c) ? 0 : this.base[c]));
  }

  // Co-occurrence model. Each seen card s shifts card c's log-odds by its
  // log-lift logit(P(c|s)) - logit(P(c)). Staples barely move anything because
  // P(c|staple) is close to P(c). Smoothing pulls rare-card conditionals back
  // toward the baseline. The result is rescaled so the probabilities sum to the
  // number of cards still unseen.
  cooccurrence(seen) {
    const { smoothing: k, damping } = this.params;
    const n = this.ids.length;
    const s = new Set(seen);
    const scale = seen.length ? 1 / Math.pow(seen.length, damping) : 0;
    const logits = new Float64Array(n);
    for (let c = 0; c < n; c++) {
      if (s.has(c)) { logits[c] = -Infinity; continue; }
      const lb = logit(this.base[c]);
      let shift = 0;
      for (const x of seen) {
        const cond = clampP((this.pairW[c * n + x] + k * this.base[c]) / (this.cardW[x] + k));
        shift += logit(cond) - lb;
      }
      logits[c] = lb + scale * shift;
    }
    return calibrate(logits, DECK_SIZE - seen.length);
  }

  // Soft deck match: decks containing most of the seen cards, each weighted by
  // games × e^(-penalty × missing). Returns null when no deck qualifies.
  deckMatch(seen) {
    const { maxMismatch, mismatchPenalty } = this.params;
    const allowed = Math.min(maxMismatch, Math.max(0, seen.length - 2));
    const s = new Set(seen);
    const n = this.ids.length;
    const acc = new Float64Array(n);
    let mass = 0, strong = 0;
    const top = [];
    for (const d of this.decks) {
      let hit = 0;
      for (let i = 1; i <= DECK_SIZE; i++) if (s.has(d[i])) hit++;
      const miss = seen.length - hit;
      if (miss > allowed) continue;
      const w = d[0] * Math.exp(-mismatchPenalty * miss);
      mass += w;
      if (miss <= 1) strong += d[0];
      for (let i = 1; i <= DECK_SIZE; i++) acc[d[i]] += w;
      top.push({ deck: d, miss, w });
    }
    if (!mass) return null;
    top.sort((a, b) => b.w - a.w);
    const probs = Array.from(acc, (v, c) => (s.has(c) ? 0 : v / mass));
    return { probs, mass, strong, top: top.slice(0, 5) };
  }

  // Final P(card in deck): co-occurrence, with the deck match blended in only
  // when a strong partial match exists (decks missing at most one seen card).
  predict(seen) {
    const cooc = this.cooccurrence(seen);
    const match = seen.length >= 2 ? this.deckMatch(seen) : null;
    let alpha = 0;
    if (match && match.strong > 0) {
      alpha = this.params.matchMax * (1 - Math.exp(-match.strong / this.params.matchHalfGames));
    }
    const probs = alpha ? cooc.map((p, c) => (1 - alpha) * p + alpha * match.probs[c]) : cooc;
    return { probs, alpha, match };
  }

  // Seen cards as defIds -> indices. Cards outside the dataset are dropped
  // (they still count toward cards played).
  toIndices(defIds) {
    return defIds.map((id) => this.index.get(id)).filter((i) => i !== undefined);
  }
}

// Shift all logits by one constant so the probabilities sum to `target`.
function calibrate(logits, target) {
  let lo = -30, hi = 30;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    let sum = 0;
    for (const l of logits) if (l !== -Infinity) sum += sigmoid(l + mid);
    if (sum > target) hi = mid; else lo = mid;
  }
  const b = (lo + hi) / 2;
  return Array.from(logits, (l) => (l === -Infinity ? 0 : sigmoid(l + b)));
}

// P(in hand) ≈ P(in deck) × hand size / cards not yet played.
export function handProbability(pDeck, handSize, cardsPlayed) {
  const remaining = DECK_SIZE - cardsPlayed;
  if (remaining <= 0) return 0;
  return Math.min(1, pDeck * Math.min(handSize, remaining) / remaining);
}

// Relative chance a card in hand is played this turn: zero if unaffordable,
// highest when it uses all the available energy. Cost reducers are not modelled.
export function costWeight(cost, energy) {
  if (cost > energy) return 0;
  if (energy <= 0) return 1;
  return 0.35 + 0.65 * (cost / energy);
}

export function nextPlayLikelihood(pHand, cost, energy) {
  return pHand * costWeight(cost, energy);
}

// Opponent's likely max added power this turn: the strongest combination
// (up to 3 cards, total cost <= energy) of their top predicted affordable
// cards. Uses printed power only.
export function opponentThreat(candidates, energy, { minHand = 0.15, pool = 6 } = {}) {
  const top = candidates
    .filter((c) => c.cost <= energy && c.pHand >= minHand)
    .sort((a, b) => b.pNext - a.pNext)
    .slice(0, pool);
  let best = { power: 0, cards: [] };
  const walk = (start, cost, power, picked) => {
    if (power > best.power) best = { power, cards: [...picked] };
    if (picked.length === 3) return;
    for (let i = start; i < top.length; i++) {
      const c = top[i];
      if (cost + c.cost > energy) continue;
      picked.push(c);
      walk(i + 1, cost + c.cost, power + c.power, picked);
      picked.pop();
    }
  };
  walk(0, 0, 0, []);
  return { ...best, notModelled: best.cards.filter((c) => c.ongoing || c.special) };
}

// Per lane: power I need to win it now, and whether the opponent's likely max
// added power would flip it.
export function laneStatus(mine, theirs, threatPower) {
  const need = Math.max(0, theirs - mine + 1);
  const margin = mine - (theirs + threatPower);
  let status;
  if (need > 0) status = 'losing';
  else if (margin > 0) status = 'safe';
  else status = 'at-risk';
  return { need, needVsThreat: Math.max(0, theirs + threatPower - mine + 1), margin, status };
}
