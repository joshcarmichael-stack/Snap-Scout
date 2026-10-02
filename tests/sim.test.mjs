import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { winChance, snapAdvice } from '../sim.js';

const { cards: list } = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url)));
const cards = new Map(list.map((c) => [c.id, c]));
const D = JSON.parse(readFileSync(new URL('../data/decks.json', import.meta.url)));
const lanes = [{ loc: null }, { loc: null }, { loc: null }];
const base = { lanes, cards, avgPower: () => 5, lastTurn: 6, energyAt: (t) => t };

test('a mirror match from turn 1 is close to 50%', () => {
  const deck = D.decks[3].slice(1).map((i) => D.ids[i]);
  const r = winChance({ ...base, events: [], turn: 1, oppRows: deck.map((id) => ({ id, pDeck: 1 })), oppSeen: 0, oppHand: 4, myHand: [], myDeckLeft: deck, myHandSize: 4, runs: 300, seed: 4 });
  assert.ok(r.p > 0.4 && r.p < 0.6, `got ${r.p}`);
});

test('the opponent uses Arnim Zola on a Wong + Black Panther lane', () => {
  const events = [
    { t: 'play', uid: 'a', side: 'me', id: 'MistyKnight', lane: 1, turn: 1 },
    { t: 'play', uid: 'b', side: 'me', id: 'Cyclops', lane: 2, turn: 3 },
    { t: 'play', uid: 'c', side: 'opp', id: 'Wong', lane: 0, turn: 4 },
    { t: 'play', uid: 'd', side: 'opp', id: 'BlackPanther', lane: 0, turn: 5 },
  ];
  const certain = winChance({ ...base, events, turn: 6, oppRows: [{ id: 'ArnimZola', pDeck: 1 }], oppSeen: 11, oppHand: 1, myHand: [{ id: 'Abomination' }], myDeckLeft: [], myHandSize: 0, runs: 20, seed: 1 });
  assert.ok(certain.p < 0.2, `got ${certain.p}`);
});

test('snap advice bands', () => {
  assert.equal(snapAdvice(0.8).call, 'Snap');
  assert.equal(snapAdvice(0.5).call, 'Play it out');
  assert.equal(snapAdvice(0.1).call, 'Retreat');
});
