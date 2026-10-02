import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBoard } from '../engine.js';

const { cards: list } = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url)));
const cards = new Map(list.map((c) => [c.id, c]));
const lanes = [{ loc: null }, { loc: null }, { loc: null }];
const zc = (id, extra) => ({ id, cost: cards.get(id).cost, power: cards.get(id).power, ...extra });
const zones = (me, opp = { hand: [], deck: [] }) => ({ me: { discard: [], ...me }, opp: { discard: [], ...opp } });
let n = 0;
const play = (side, id, lane, turn) => ({ t: 'play', uid: `z${++n}`, side, id, lane, turn });
const sim = (events, z, turn, from = 1) => buildBoard(events, { cards, lanes, turn, zones: z, zonesAt: 0, zonesTurn: from, rand: () => 0.5 });

test('Surge buffs the top card, and again after you play it', () => {
  const z = zones({ hand: [zc('Surge')], deck: [zc('Hulk'), zc('Abomination'), zc('Cyclops')] });
  const b = sim([play('me', 'Surge', 0, 2), play('me', 'Hulk', 1, 3)], z, 3, 2);
  assert.equal(b.power(b.active.find((c) => c.id === 'Hulk')), 15);
  const abom = b.zones.me.deck.find((k) => k.id === 'Abomination');
  assert.deepEqual([abom.cost, abom.power], [4, 10]);
});

test('Blade discards Apocalypse, which comes back with +4', () => {
  const z = zones({ hand: [zc('Blade'), zc('Apocalypse')], deck: [] });
  const b = sim([play('me', 'Blade', 0, 1)], z, 1);
  const apoc = b.zones.me.hand.find((k) => k.id === 'Apocalypse');
  assert.equal(apoc.power, 13);
});

test('Hela resurrects discarded cards', () => {
  const z = zones({ hand: [zc('Modok'), zc('Hulk'), zc('Hela')], deck: [] });
  const b = sim([play('me', 'Modok', 0, 5)], z, 6, 5);
  assert.equal(b.zones.me.discard.length, 2); // Hulk and Hela
});

test('Magik makes it a 7-turn game; Psylocke and Electro change energy', () => {
  const b = sim([play('me', 'Magik', 1, 3)], zones({ hand: [zc('Magik')], deck: [] }), 3, 3);
  assert.equal(b.lastTurn, 7);
  const p = sim([play('me', 'Psylocke', 0, 2)], zones({ hand: [zc('Psylocke')], deck: [] }), 3, 2);
  assert.equal(p.energyFor('me', 3), 4);
  const e = sim([play('me', 'Electro', 0, 3)], zones({ hand: [zc('Electro')], deck: [] }), 4, 3);
  assert.deepEqual([e.energyFor('me', 4), e.maxPlays('me')], [5, 1]);
});

test('cards are drawn each turn in playouts; Death gets cheaper as cards die', () => {
  const z = zones({ hand: [zc('Death')], deck: [zc('Hulk'), zc('Cyclops')] });
  const b = sim([], z, 3, 1);
  assert.equal(b.zones.me.hand.length, 3);
  const d = sim([play('opp', 'MistyKnight', 0, 1), play('me', 'Killmonger', 1, 3)], zones({ hand: [zc('Killmonger'), zc('Death')], deck: [] }), 3, 1);
  assert.equal(d.costOf('me', d.zones.me.hand.find((k) => k.id === 'Death')), 7);
});

test('Anti-Polar Magneto places likely 3/4-Costs from the predicted hand on the live board', () => {
  const guess = (side, where, filter) => ['Cyclops', 'Hulk'].find((id) => !filter || filter(zc(id)));
  const b = buildBoard([play('opp', 'AntiPolarMagneto', 0, 6)], { cards, lanes, turn: 6, guess });
  const placed = b.active.filter((c) => c.id === 'Cyclops');
  assert.equal(placed.length, 2);
  assert.ok(placed.every((c) => c.guess));
});
