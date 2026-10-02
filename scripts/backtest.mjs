// Backtest: hold out decks, reveal N random cards from each, measure how many
// of the top-5 / top-10 predictions are among the deck's hidden cards.
//   node scripts/backtest.mjs [--samples 3000] [--seed 1] [--tune]
// Decklists are split 80/20 into train/test by a hash of the list, so a test
// deck is never in the training data. Test decks are sampled in proportion to
// games played, matching how often you'd actually face them.
import { readFileSync } from 'node:fs';
import { Model, DEFAULT_PARAMS, DECK_SIZE } from '../model.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : Number(args[i + 1]);
};
const SAMPLES = opt('samples', 3000);
const SEED = opt('seed', 1);
const TUNE = args.includes('--tune');
const REVEALS = [2, 3, 4, 5, 6];

const { ids, decks } = JSON.parse(readFileSync(new URL('../data/decks.json', import.meta.url)));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashList(d) {
  let h = 2166136261;
  for (const c of d.slice(1).sort((a, b) => a - b)) h = Math.imul(h ^ c, 16777619);
  return (h >>> 0) / 4294967296;
}

function split(list, frac, salt) {
  const a = [], b = [];
  for (const d of list) ((hashList(d) * 7919 + salt) % 1 < frac ? a : b).push(d);
  return [a, b];
}

function weightedSampler(list, rand) {
  const cum = [];
  let t = 0;
  for (const d of list) cum.push((t += d[0]));
  return () => {
    const x = rand() * t;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
    return list[lo];
  };
}

// Fixed scenario list so every method sees identical reveals.
function scenarios(testDecks, n, seed) {
  const rand = mulberry32(seed);
  const pick = weightedSampler(testDecks, rand);
  const out = [];
  for (const N of REVEALS) {
    for (let i = 0; i < n; i++) {
      const cards = pick().slice(1);
      for (let j = cards.length - 1; j > 0; j--) {
        const k = Math.floor(rand() * (j + 1));
        [cards[j], cards[k]] = [cards[k], cards[j]];
      }
      out.push({ N, seen: cards.slice(0, N), hidden: new Set(cards.slice(N)) });
    }
  }
  return out;
}

function topK(probs, k) {
  return probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).slice(0, k).map((x) => x[1]);
}

function evaluate(method, scen) {
  const byN = new Map(REVEALS.map((N) => [N, { n: 0, p5: 0, p10: 0, any5: 0, brier: 0 }]));
  for (const s of scen) {
    const probs = method(s.seen);
    const r = byN.get(s.N);
    const t10 = topK(probs, 10);
    const h5 = t10.slice(0, 5).filter((c) => s.hidden.has(c)).length;
    const h10 = t10.filter((c) => s.hidden.has(c)).length;
    r.n++; r.p5 += h5 / 5; r.p10 += h10 / 10; r.any5 += h5 > 0 ? 1 : 0;
    // Calibration of the top-10 probabilities (lower is better).
    for (const c of t10) r.brier += (probs[c] - (s.hidden.has(c) ? 1 : 0)) ** 2 / 10;
  }
  for (const r of byN.values()) { r.p5 /= r.n; r.p10 /= r.n; r.any5 /= r.n; r.brier /= r.n; }
  return byN;
}

const mean = (byN, key) => [...byN.values()].reduce((s, r) => s + r[key], 0) / byN.size;

// Old behaviour: exact deck matching — decks containing every seen card,
// falling back to popularity when none do.
function exactMatch(model) {
  return (seen) => {
    const acc = new Float64Array(model.ids.length);
    const s = new Set(seen);
    let mass = 0;
    for (const d of model.decks) {
      let ok = true;
      for (const c of seen) if (!d.includes(c, 1)) { ok = false; break; }
      if (!ok) continue;
      mass += d[0];
      for (let i = 1; i <= DECK_SIZE; i++) acc[d[i]] += d[0];
    }
    if (!mass) return model.popularity(seen);
    return Array.from(acc, (v, c) => (s.has(c) ? 0 : v / mass));
  };
}

const [train, test] = split(decks, 0.8, 0);

let params = { ...DEFAULT_PARAMS };
if (TUNE) {
  // Tune on a validation slice of the training decks only; the test split
  // stays untouched until the final report.
  const [fit, val] = split(train, 0.85, 0.5);
  const scen = scenarios(val, Math.round(SAMPLES / 3), SEED + 100);
  const score = (p) => {
    const m = new Model(ids, fit, p);
    const r = evaluate((s) => m.predict(s).probs, scen);
    return mean(r, 'p5') + mean(r, 'p10');
  };
  const grid = {
    smoothing: [5, 20, 50, 150],
    damping: [0.25, 0.5, 0.75, 1],
    mismatchPenalty: [0.75, 1.5, 3],
    matchMax: [0, 0.3, 0.6, 0.85],
    matchHalfGames: [100, 400, 1500],
  };
  // Coordinate descent: a couple of passes over each parameter.
  let best = score(params);
  for (let pass = 0; pass < 2; pass++) {
    for (const [key, values] of Object.entries(grid)) {
      for (const v of values) {
        if (v === params[key]) continue;
        const cand = { ...params, [key]: v };
        const sc = score(cand);
        if (sc > best + 1e-4) { best = sc; params = cand; }
      }
    }
  }
  console.log('Tuned params:', JSON.stringify(params));
}

const model = new Model(ids, train, params);
const scen = scenarios(test, SAMPLES, SEED);
const methods = {
  'Popularity (baseline)': (s) => model.popularity(s),
  'Exact deck match (old)': exactMatch(model),
  'Co-occurrence only': (s) => model.cooccurrence(s),
  'Co-occurrence + soft match': (s) => model.predict(s).probs,
};

const pct = (x) => `${(100 * x).toFixed(1)}%`.padStart(6);
console.log(`\nTrain ${train.length} decks, test ${test.length} decks, ${SAMPLES} samples per N (weighted by games).`);
console.log('Top-5 / top-10 = share of the top predictions that are really in the hidden part of the deck.\n');
const results = {};
for (const [name, fn] of Object.entries(methods)) {
  const t0 = Date.now();
  results[name] = evaluate(fn, scen);
  results[name].ms = (Date.now() - t0) / scen.length;
}
const header = ['N'.padEnd(3), ...Object.keys(methods).map((m) => m.padStart(28))].join(' ');
for (const [label, key] of [['Top-5 hit rate', 'p5'], ['Top-10 hit rate', 'p10'], ['≥1 hit in top 5', 'any5']]) {
  console.log(label);
  console.log(header);
  for (const N of REVEALS) {
    console.log([String(N).padEnd(3), ...Object.keys(methods).map((m) => pct(results[m].get(N)[key]).padStart(28))].join(' '));
  }
  console.log();
}
console.log('Avg ms per prediction:', Object.entries(results).map(([m, r]) => `${m}: ${r.ms.toFixed(2)}`).join(', '));
