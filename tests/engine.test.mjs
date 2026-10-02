import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBoard } from '../engine.js';

const { cards: list } = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url)));
const cards = new Map(list.map((c) => [c.id, c]));
const noLocs = [{ loc: null }, { loc: null }, { loc: null }];
let n = 0;
const play = (side, id, lane, turn = 1) => ({ t: 'play', uid: `u${++n}`, side, id, lane, turn });
const run = (events, lanes = noLocs, turn = 6) => buildBoard(events, { cards, lanes, turn });
const totals = (b, side = 'me') => b.lanes.map((l) => l[side].power);
const powerOf = (b, id) => b.active.filter((c) => c.id === id).map((c) => b.power(c));

test('Iron Fist moves Human Torch left (doubling), Ghost-Spider pulls it back (doubling again)', () => {
  const b = run([play('me', 'IronFist', 1, 1), play('me', 'HumanTorch', 1, 3), play('me', 'GhostSpider', 2, 3)]);
  assert.deepEqual(powerOf(b, 'HumanTorch'), [8]);
  assert.equal(b.active.find((c) => c.id === 'HumanTorch').lane, 2);
  assert.deepEqual(totals(b), [0, 3, 11]);
});

test('Black Panther doubles, twice with Wong', () => {
  assert.deepEqual(powerOf(run([play('me', 'BlackPanther', 0, 5)]), 'BlackPanther'), [10]);
  assert.deepEqual(powerOf(run([play('me', 'Wong', 0, 4), play('me', 'BlackPanther', 0, 5)]), 'BlackPanther'), [20]);
});

test('Arnim Zola copies Black Panther to the other lanes', () => {
  const b = run([play('opp', 'BlackPanther', 0, 5), play('opp', 'ArnimZola', 0, 6)]);
  assert.deepEqual(totals(b, 'opp'), [0, 10, 10]);
  // With Wong, Arnim fires twice: Black Panther (20) and then Wong get copied.
  const w = run([play('opp', 'Wong', 0, 4), play('opp', 'BlackPanther', 0, 5), play('opp', 'ArnimZola', 0, 6)]);
  assert.deepEqual(totals(w, 'opp'), [0, 22, 22]);
});

test('Cosmo stops On Reveals at its location', () => {
  const b = run([play('opp', 'Cosmo', 0, 3), play('me', 'BlackPanther', 0, 5)]);
  assert.deepEqual(powerOf(b, 'BlackPanther'), [5]);
});

test('Multiple Man leaves a copy when moved', () => {
  const b = run([play('me', 'MultipleMan', 0, 2), { t: 'move', uid: `u${n}`, lane: 1, turn: 3 }]);
  assert.deepEqual(totals(b), [4, 4, 0]);
});

test('Nidavellir buff is live: lost when the card moves away', () => {
  const lanes = [{ loc: 'Nidavellir' }, { loc: null }, { loc: null }];
  const ev = [play('me', 'Vision', 0, 5)];
  assert.deepEqual(totals(run(ev, lanes)), [14, 0, 0]);
  ev.push({ t: 'move', uid: ev[0].uid, lane: 1, turn: 6 });
  assert.deepEqual(totals(run(ev, lanes)), [0, 9, 0]);
});

test('Muir Island end-of-turn growth over turns', () => {
  const lanes = [{ loc: 'MuirIsland' }, { loc: null }, { loc: null }];
  const b = run([play('me', 'MistyKnight', 0, 1)], lanes, 4); // ends of turns 1–3
  assert.deepEqual(totals(b), [6, 0, 0]);
});

test('Killmonger destroys 1-Costs; Knull collects', () => {
  const b = run([play('opp', 'MistyKnight', 0, 1), play('me', 'Killmonger', 1, 3), play('me', 'Knull', 2, 6)]);
  assert.deepEqual(totals(b, 'opp'), [0, 0, 0]);
  assert.deepEqual(powerOf(b, 'Knull'), [3]);
});

test('Grandmaster + Odin repeats stop instead of looping forever', () => {
  const b = run([play('opp', 'Odin', 0, 6), play('opp', 'GrandMaster', 0, 6)]);
  assert.ok(b.active.length >= 2);
});

test('every top-150 meta card with an ability has a rule', async () => {
  const { ABILITIES } = await import('../abilities.js');
  const d = JSON.parse(readFileSync(new URL('../data/decks.json', import.meta.url)));
  const w = new Map();
  for (const x of d.decks) for (let i = 1; i <= 12; i++) w.set(d.ids[x[i]], (w.get(d.ids[x[i]]) || 0) + x[0]);
  const top = [...w].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([id]) => id);
  const missing = top.filter((id) => cards.get(id)?.special && !ABILITIES[id]);
  assert.deepEqual(missing, [], 'add these to abilities.js');
});
