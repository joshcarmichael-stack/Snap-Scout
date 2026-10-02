// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCATION_EFFECTS, boardModifiers, laneRules, evaluateBoard } from '../locations.js';
import { opponentThreat } from '../model.js';
import { parseDeck, deckCode } from '../decks.js';

const { locations } = JSON.parse(readFileSync(new URL('../data/locations.json', import.meta.url)));
const { cards } = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url)));
const lane = (o) => ({ loc: null, mine: 0, theirs: 0, myCards: 0, oppCards: 0, ...o });
const avg = () => 5;
const card = (name, cost, power, extra = {}) => ({ id: name, name, cost, power, pHand: 0.5, pNext: 0.5, ...extra });

test('every released location has a rule', () => {
  const missing = locations.filter((l) => !LOCATION_EFFECTS[l.id]).map((l) => `${l.id}: ${l.ability}`);
  assert.deepEqual(missing, [], 'add these to LOCATION_EFFECTS in locations.js');
});

function board(lanes, turn, rows) {
  const mods = boardModifiers(lanes, turn, avg);
  const energy = turn + mods.oppEnergy;
  return evaluateBoard(lanes, turn, (i) => opponentThreat(rows, energy, laneRules(lanes, i, turn, 'opp', avg, mods)), avg);
}

test('Nidavellir adds +5 per card to the threat', () => {
  const b = board([lane({ loc: 'Nidavellir', mine: 10 }), lane(), lane()], 3, [card('A', 3, 3)]);
  assert.equal(b[0].threat.power, 8);
  assert.equal(b[1].threat.power, 3);
});

test('The Big House blocks 4+ cost threats', () => {
  const b = board([lane(), lane({ loc: 'TheBigHouse' }), lane()], 4, [card('Big', 4, 9), card('Small', 2, 3)]);
  assert.deepEqual(b[1].threat.cards.map((c) => c.name), ['Small']);
});

test('Project Pegasus gives +5 energy only on its reveal turn', () => {
  const lanes = [lane(), lane(), lane({ loc: 'ProjectPegasus' })];
  assert.equal(boardModifiers(lanes, 3, avg).oppEnergy, 5);
  assert.equal(boardModifiers(lanes, 4, avg).oppEnergy, 0);
});

test('Murderworld wipes the lane at end of turn 3', () => {
  const b = board([lane({ loc: 'Murderworld', mine: 9, theirs: 2, myCards: 2, oppCards: 1 }), lane(), lane()], 3, []);
  assert.equal(b[0].status, 'losing');
});

test('Baxter Building flip puts other lanes at risk', () => {
  const lanes = [lane({ mine: 8, theirs: 6 }), lane({ loc: 'BaxterBuilding', mine: 5, theirs: 4 }), lane()];
  const b = board(lanes, 2, [card('A', 2, 3)]);
  assert.equal(b[1].status, 'at-risk');
  assert.equal(b[0].status, 'at-risk');
});

test('Cancun lanes never count', () => {
  const b = board([lane({ loc: 'Cancun', mine: 0, theirs: 20 }), lane(), lane()], 2, []);
  assert.equal(b[0].status, 'closed');
});

test('deck codes round-trip', () => {
  const ids = ['Blade', 'Scorn', 'Apocalypse', 'Dracula'];
  const r = parseDeck(deckCode(ids), cards);
  assert.deepEqual(r.cards, ids);
});
