// Hand, deck, discard, cost and energy abilities. These run for real in the
// win-chance playouts (both sides have sampled hands and decks). On the live
// board, hands and decks are unknown, so effects that put a hand/deck card on
// the board use the most likely card (shown as "likely", tap to correct) and
// purely in-hand effects have no visible effect.
//
// Extra hooks used here:
//   cost(g, side, card, cost)  what this card costs in hand right now
//   canPlay(g, side, lane)     play restriction for this card
//   discarded(g, side, card)   when this card is discarded (card is the hand card)
//   allyDiscarded(g, c, card)  when you discard while this card is in play
//   sot(g, c)                  start of turn

const other = (s) => (s === 'me' ? 'opp' : 'me');
const mine = (g, c) => g.at(c.lane, c.side).filter((x) => x !== c);
const enemy = (g, c) => g.at(c.lane, other(c.side));
const allies = (g, c) => g.active().filter((x) => x.side === c.side && x !== c);
const foes = (g, c) => g.active().filter((x) => x.side !== c.side);
const byPower = (g) => (a, b) => g.power(b) - g.power(a);
const info = (g, id) => g.cardsById.get(id) || { cost: 0, power: 0, ability: '' };
const freeLane = (g, side, not) => [0, 1, 2].filter((l) => l !== not && !g.full(l, side)).sort((a, b) => g.at(a, side).length - g.at(b, side).length)[0];
const sideTotal = (g, lane, side) => { g.computeLive(); return g.sideTotal(lane, side); };
const winningAt = (g, lane, side) => sideTotal(g, lane, side) > sideTotal(g, lane, other(side));
const addN = (g, side, id, n, extra) => { for (let i = 0; i < n; i++) g.addToHand(side, id, extra); };
const random = (g, side, filter, extra) => g.addToHand(side, g.randomId(filter), extra);
const hand = (g, side) => g.hand(side);
const deck = (g, side) => g.deck(side);

const M = (note, hooks) => ({ kind: 'modelled', note, ...hooks });
const A = (note, hooks) => ({ kind: 'approx', note, ...hooks });

// Surge: top card −1 Cost +1 Power; repeats on the new top card after you play it.
const surge = (g, side) => { const k = deck(g, side)[0]; if (!k) return; k.cost = Math.max(0, k.cost - 1); k.power += 1; k.onPlay = (g2) => surge(g2, side); };

// Thanos (Fractured Frontier) Infinity Shots, in the order they load.
const SHOTS = ['PowerShot', 'SoulShot', 'SpaceShot', 'RealityShot', 'TimeShot', 'MindShot'];
const fireShot = (g, c, id) => {
  if (id === 'PowerShot') g.buff(c, 3);
  if (id === 'SpaceShot') g.buff(c, 1);
  if (id === 'SoulShot') { const t = enemy(g, c).sort((a, b) => g.power(a) - g.power(b))[0]; if (t) g.destroy(t); }
  if (id === 'RealityShot') { const t = mine(g, c).sort((a, b) => g.info(a).cost - g.info(b).cost)[0]; if (t) g.copy(t, c.lane); }
  if (id === 'TimeShot') hand(g, c.side).forEach((k) => { k.cost = Math.max(0, k.cost - 1); });
  if (id === 'MindShot') g.draw(c.side);
};

export const ZONE_ABILITIES = {
  // ---- Thanos (Fractured Frontier) -----------------------------------------
  ThanosFracturedFrontier: M('Fires the Infinity Shots loaded by Quickdraw plays (tracked in playouts; on the board, set which shots fired).', {
    reveal: (g, c) => { for (let i = 0; i < (g.sim ? g.shots[c.side] : 0); i++) fireShot(g, c, SHOTS[i]); g.shots[c.side] = 0; },
  }),
  ...Object.fromEntries(SHOTS.map((id) => [id, M({ PowerShot: '+3 Power.', SoulShot: 'Destroys the weakest enemy card here.', SpaceShot: '+1 Power.', RealityShot: 'Copies your cheapest other card here.', TimeShot: 'Your hand costs 1 less.', MindShot: 'Draws a card.' }[id], { reveal: (g, c) => fireShot(g, c, id) })])),

  // ---- Buffing hand and deck -----------------------------------------------
  Surge: M('Top card of your deck: −1 Cost, +1 Power; repeats after you play it.', { reveal: (g, c) => surge(g, c.side) }),
  AmericaChavez: M('Top card of your deck gets +3 Power.', { reveal: (g, c) => { const k = deck(g, c.side)[0]; if (k) k.power += 3; } }),
  Okoye: M('Every card in your deck gets +1 Power.', { reveal: (g, c) => deck(g, c.side).forEach((k) => { k.power += 1; }) }),
  Phastos: M('Each card in your deck: −1 Cost (4+ Cost) or +2 Power.', { reveal: (g, c) => deck(g, c.side).forEach((k) => { if (k.cost >= 4) k.cost -= 1; else k.power += 2; }) }),
  Zabu: M('4-Costs in your deck cost 1 less.', { reveal: (g, c) => deck(g, c.side).forEach((k) => { if (k.cost === 4) k.cost = 3; }) }),
  Nakia: M('Cards in your hand get +1 Power.', { reveal: (g, c) => hand(g, c.side).forEach((k) => { k.power += 1; }) }),
  MajesticWingbeat: M('Leftmost card in hand +3 Power (and −1 Cost if 5+).', { reveal: (g, c) => { const k = hand(g, c.side)[0]; if (k) { k.power += 3; if (k.cost >= 5) k.cost -= 1; } } }),
  PsylockeFracturedFrontier: M('Your 5+ Cost cards in hand cost 1 less.', { reveal: (g, c) => hand(g, c.side).forEach((k) => { if (k.cost >= 5) k.cost -= 1; }) }),
  Bast: M('Sets the Power of cards in your hand to 3.', { reveal: (g, c) => hand(g, c.side).forEach((k) => { k.power = 3; }) }),
  MrFantasticFirstSteps: M('End of turn: a card in hand gets −1 Cost or +3 Power.', { eot: (g, c) => { const k = hand(g, c.side).sort((a, b) => b.cost - a.cost)[0]; if (k) { if (k.cost > g.turn) k.cost -= 1; else k.power += 3; } } }),
  RedWolfFracturedFrontier: M('+1 for each card in your hand.', { reveal: (g, c) => g.buff(c, g.sim ? hand(g, c.side).length : 3) }),
  Kahhori: A('Each card in hand gives one of your cards +1.', { reveal: (g, c) => { const t = allies(g, c).sort(byPower(g)); const n = g.sim ? hand(g, c.side).length : 3; for (let i = 0; i < n && t.length; i++) g.buff(t[i % t.length], 1); } }),
  Gwenpool: M('A random card in hand gets +2, three times.', { reveal: (g, c) => { const h = hand(g, c.side); for (let i = 0; i < 3 && h.length; i++) h[Math.floor(g.rand() * h.length)].power += 2; } }),
  ToxieDoxie: M('Two cards in hand get +2.', { reveal: (g, c) => hand(g, c.side).slice(0, 2).forEach((k) => { k.power += 2; }) }),
  CassandraNova: M('Steals 1 Power from each card in the opponent’s deck.', { reveal: (g, c) => { const d = deck(g, other(c.side)); d.forEach((k) => { k.power -= 1; }); g.buff(c, g.sim ? d.length : Math.max(0, 9 - g.turn)); } }),
  SilverSable: M('Steals 2 Power from the top of the opponent’s deck.', { reveal: (g, c) => { const k = deck(g, other(c.side))[0]; if (k) k.power -= 2; g.buff(c, 2); } }),
  DragonOfTheMoon: M('Steals 1 from even-Cost cards in all hands.', { reveal: (g, c) => ['me', 'opp'].forEach((s) => hand(g, s).forEach((k) => { if (k.cost % 2 === 0) { k.power -= 1; g.buff(c, 1); } })) }),

  // ---- Against the opponent's hand / deck -----------------------------------
  Scorpion: M('Cards in the opponent’s hand get −1 Power.', { reveal: (g, c) => hand(g, other(c.side)).forEach((k) => { k.power -= 1; }) }),
  Iceman: M('A card in the opponent’s hand costs 1 more.', { reveal: (g, c) => { const h = hand(g, other(c.side)); const k = h[Math.floor(g.rand() * h.length)]; if (k) k.cost = Math.min(6, k.cost + 1); } }),
  Selene: M('The weakest card in each hand gets −3.', { reveal: (g, c) => ['me', 'opp'].forEach((s) => { const k = hand(g, s).slice().sort((a, b) => a.power - b.power)[0]; if (k) k.power -= 3; }) }),
  Leech: M('Removes the text of 6-Costs in the opponent’s hand.', { reveal: (g, c) => hand(g, other(c.side)).forEach((k) => { if (k.cost === 6) k.silenced = true; }) }),
  SpiderHam: A('Activate: changes a card in their hand.', {}),
  Sandman: M('Next turn, cards cost 1 more (max 6).', { reveal: (g, c) => ['me', 'opp'].forEach((s) => { g.costUp[s][g.turn + 1] = (g.costUp[s][g.turn + 1] || 0) + 1; }) }),
  Wave: M('All cards cost at most 4 until the end of next turn.', { reveal: (g) => { g.costCap = { cap: 4, until: g.turn + 1 }; } }),
  BaronMordo: M('Their top card costs 6 until turn 6.', { reveal: (g, c) => { const k = deck(g, other(c.side))[0]; if (k) k.cost = 6; } }),
  Kluh: M('Each player’s random hand card gets −1 Cost per different Cost they have in play.', { reveal: (g, c) => ['me', 'opp'].forEach((s) => { const h = hand(g, s); const k = h[Math.floor(g.rand() * h.length)]; const n = new Set(g.active().filter((x) => x.side === s).map((x) => g.info(x).cost)).size; if (k) k.cost = Math.max(0, k.cost - n); }) }),
  Yondu: M('Banishes the cheapest card in their deck.', { reveal: (g, c) => { const d = deck(g, other(c.side)); const k = d.slice().sort((a, b) => a.cost - b.cost)[0]; if (k) d.splice(d.indexOf(k), 1); } }),
  Korg: M('Shuffles a Rock into their deck.', { reveal: (g, c) => { const d = deck(g, other(c.side)); d.splice(Math.floor(g.rand() * (d.length + 1)), 0, g.zoneCard('Rock')); } }),
  Rockslide: M('Shuffles 2 Rocks into their deck.', { reveal: (g, c) => { const d = deck(g, other(c.side)); for (let i = 0; i < 2; i++) d.splice(Math.floor(g.rand() * (d.length + 1)), 0, g.zoneCard('Rock')); } }),
  MasterMold: M('Adds 2 Sentinels to their hand.', { reveal: (g, c) => addN(g, other(c.side), 'Sentinel', 2) }),
  Maximus: M('The opponent draws 2.', { reveal: (g, c) => { g.draw(other(c.side)); g.draw(other(c.side)); } }),
  BlackBolt: M('Discards the cheapest card from their hand.', { reveal: (g, c) => g.discard(other(c.side), (h) => h.slice().sort((a, b) => a.cost - b.cost)[0]) }),

  // ---- Adding cards to your hand ---------------------------------------------
  AgentCoulson: M('Adds a random 4-Cost and 5-Cost card to your hand.', { reveal: (g, c) => { random(g, c.side, (x) => x.cost === 4); random(g, c.side, (x) => x.cost === 5); } }),
  MariaHill: M('Adds a random 2-Cost card to your hand.', { reveal: (g, c) => random(g, c.side, (x) => x.cost === 2) }),
  Agent13: M('Adds a random card to your hand.', { reveal: (g, c) => random(g, c.side) }),
  NickFury: M('Adds 3 random 6-Costs to your hand.', { reveal: (g, c) => { for (let i = 0; i < 3; i++) random(g, c.side, (x) => x.cost === 6); } }),
  Valentina: M('Adds a random 6-Cost (−2 Cost, −2 Power) to your hand.', { reveal: (g, c) => { const k = random(g, c.side, (x) => x.cost === 6); if (k) { k.cost -= 2; k.power -= 2; k.created = true; } } }),
  IronPatriot: M('Adds a random 4+ Cost card to your hand.', { reveal: (g, c) => { const k = random(g, c.side, (x) => x.cost >= 4); if (k) k.created = true; } }),
  Hood: M('Adds a 6-Power Demon to your hand.', { reveal: (g, c) => g.addToHand(c.side, 'Demon', { created: true }) }),
  Sentinel: M('Adds another Sentinel to your hand.', { reveal: (g, c) => g.addToHand(c.side, 'Sentinel', { created: true }) }),
  KateBishop: M('Adds 2 Arrows to your hand.', { reveal: (g, c) => { g.addToHand(c.side, 'BasicArrow', { created: true }); g.addToHand(c.side, 'GrappleArrow', { created: true }); } }),
  PeniParker: M('Adds SP//dr to your hand.', { reveal: (g, c) => g.addToHand(c.side, 'SPdr', { created: true }) }),
  TheAncientOne: M('Adds Tao Mandala to your hand.', { reveal: (g, c) => g.addToHand(c.side, 'TaoMandala', { created: true }) }),
  Mirage: M('Copies their cheapest hand card (+2) into your hand.', { reveal: (g, c) => { const k = hand(g, other(c.side)).slice().sort((a, b) => a.cost - b.cost)[0]; if (k) g.addToHand(c.side, k.id, { power: k.power + 2, created: true }); } }),
  WhiteQueen: M('Copies their most expensive hand card into your hand.', { reveal: (g, c) => { const k = hand(g, other(c.side)).slice().sort((a, b) => b.cost - a.cost)[0]; if (k) g.addToHand(c.side, k.id, { created: true }); } }),
  Frigga: M('Adds a copy of the last card you played to your hand.', { reveal: (g, c) => { const t = g.lastPlayed[c.side]; if (t && t !== c) g.addToHand(c.side, t.id, { created: true }); } }),
  MotherAskani: M('Copies your leftmost hand card (−1 Cost, +2 Power).', { reveal: (g, c) => { const k = hand(g, c.side)[0]; if (k) g.addToHand(c.side, k.id, { cost: Math.max(0, k.cost - 1), power: k.power + 2, created: true }); } }),
  MoonGirl: M('Copies your hand.', { reveal: (g, c) => hand(g, c.side).slice().forEach((k) => g.addToHand(c.side, k.id, { cost: k.cost, power: k.power, created: true })) }),
  Cable: M('Draws a card from the opponent’s deck.', { reveal: (g, c) => { const k = deck(g, other(c.side)).shift(); if (k) g.addToHand(c.side, k.id, { power: k.power, cost: k.cost }); } }),
  Crystal: M('Each player draws a card.', { reveal: (g) => { g.draw('me'); g.draw('opp'); } }),
  JaneFoster: M('Draws all 0-Cost cards from your deck.', { reveal: (g, c) => { for (let i = 0; i < 12 && hand(g, c.side).length < 7 && g.draw(c.side, (k) => k.cost === 0); i++); } }),

  // ---- Discard ---------------------------------------------------------------
  Blade: M('Discards the rightmost card in your hand.', { reveal: (g, c) => g.discard(c.side) }),
  LadySif: M('Discards the most expensive card in your hand.', { reveal: (g, c) => g.discard(c.side, (h) => h.slice().sort((a, b) => b.cost - a.cost)[0]) }),
  // Discards the hand as it is now (Apocalypse coming back doesn't get discarded again).
  Modok: M('Discards your hand.', { reveal: (g, c) => hand(g, c.side).slice().forEach((k) => g.discard(c.side, (h) => (h.includes(k) ? k : null))) }),
  ColleenWing: M('Discards the cheapest card in your hand.', { reveal: (g, c) => g.discard(c.side, (h) => h.slice().sort((a, b) => a.cost - b.cost)[0]) }),
  SwordMaster: M('Discards an odd-Cost card from your hand.', { reveal: (g, c) => g.discard(c.side, (h) => h.find((k) => k.cost % 2 === 1)) }),
  MoonKnight: M('Discards an even-Cost card from each hand.', { reveal: (g) => ['me', 'opp'].forEach((s) => g.discard(s, (h) => h.find((k) => k.cost % 2 === 0))) }),
  SilverSamurai: M('Each player discards their weakest hand card.', { reveal: (g) => ['me', 'opp'].forEach((s) => g.discard(s, (h) => h.slice().sort((a, b) => a.power - b.power)[0])) }),
  Gambit: M('Discards a card to destroy a random enemy card (on the live board, mark the destroyed card).', { reveal: (g, c) => { const f = foes(g, c); if (g.sim && g.discard(c.side) && f.length) g.destroy(f[Math.floor(g.rand() * f.length)]); } }),
  CorvusGlaive: M('Discards 2 cards for +1 max energy.', { reveal: (g, c) => { if (hand(g, c.side).length >= 2) { g.discard(c.side); g.discard(c.side); g.maxEnergy[c.side] += 1; } } }),
  RedShift: M('Swaps your leftmost card for a random one of the same Cost.', { reveal: (g, c) => { const k = g.discard(c.side, (h) => h[0]); if (k) random(g, c.side, (x) => x.cost === k.cost); } }),
  BlackCat: M('Discards itself from hand at end of turn.'),
  Apocalypse: M('When discarded, comes back with +4 Power.', { discarded: (g, side, k) => g.addToHand(side, k.id, { cost: k.cost, power: k.power + 4 }) }),
  WeaponH: M('When discarded, comes back with −2 Cost.', { discarded: (g, side, k) => g.addToHand(side, k.id, { cost: Math.max(0, k.cost - 2), power: k.power }) }),
  Swarm: M('When discarded, adds two 0-Cost copies.', { discarded: (g, side, k) => addN(g, side, 'Swarm', 2, { cost: 0, power: k.power }) }),
  Helicarrier: M('When discarded, fills your hand with random cards.', { discarded: (g, side) => { while (hand(g, side).length < 7 && random(g, side)); } }),
  Scorn: M('When discarded, comes back and +2 to itself and a card in play.', { discarded: (g, side, k) => { g.addToHand(side, k.id, { cost: k.cost, power: k.power + 2 }); const t = g.active().filter((x) => x.side === side).sort(byPower(g))[0]; if (t) g.buff(t, 2); } }),
  ProximaMidnight: M('When discarded, jumps to your weakest location.', { discarded: (g, side, k) => { const l = [0, 1, 2].filter((x) => !g.full(x, side)).sort((a, b) => sideTotal(g, a, side) - sideTotal(g, b, side))[0]; if (l != null) g.place(side, { id: k.id, power: k.power }, l, 'proxima'); } }),
  Khonshu: M('Resurrects a discarded card to another location at 5 Power.', { reveal: (g, c) => { const d = g.zones[c.side].discard; const k = d.pop(); const l = freeLane(g, c.side, c.lane); if (k && l != null) g.place(c.side, { id: k.id, power: 5 }, l, c.uid); } }),
  Hela: M('Resurrects discarded cards (one per Cost) to random locations.', { reveal: (g, c) => { const seen = new Set(); for (const k of g.zones[c.side].discard.slice()) { if (seen.has(k.cost)) continue; seen.add(k.cost); const l = freeLane(g, c.side); if (l == null) break; g.place(c.side, k, l, c.uid); g.zones[c.side].discard.splice(g.zones[c.side].discard.indexOf(k), 1); } } }),
  GhostRider: M('Brings back a discarded card here.', { reveal: (g, c) => { const d = g.zones[c.side].discard; const k = d.slice().sort((a, b) => b.power - a.power)[0]; if (k && !g.full(c.lane, c.side)) { d.splice(d.indexOf(k), 1); g.place(c.side, k, c.lane, c.uid); } } }),
  MorganLeFay: M('Returns your discarded and destroyed cards to hand (+3).', { reveal: (g, c) => { g.zones[c.side].discard.splice(0).forEach((k) => g.addToHand(c.side, k.id, { cost: k.cost, power: k.power + 3 })); } }),
  Morbius: M('+2 for each card you discarded this game.', { ongoing: (g, c, add) => add(c, 2 * g.discards[c.side]) }),
  Miek: M('+1 when you discard.', { allyDiscarded: (g, c) => g.buff(c, 1) }),
  WildChild: M('+4 if you’ve discarded, +4 if one of your cards was destroyed.', { ongoing: (g, c, add) => { if (g.discards[c.side]) add(c, 4); if (g.board.some((x) => x.side === c.side && x.gone === 'destroyed')) add(c, 4); } }),
  Dracula: M('At game end, gains a discarded hand card’s Power (counted in playouts).', { eot: (g, c) => { if (g.sim && g.turn >= (g.lastTurn || 6)) { const k = hand(g, c.side).sort((a, b) => b.power - a.power)[0]; if (k) g.buff(c, k.power); } } }),

  // ---- Energy ---------------------------------------------------------------
  Psylocke: M('+1 energy next turn.', { reveal: (g, c) => g.addEnergy(c.side, g.turn + 1, 1) }),
  Electro: M('+1 max energy; you can only play 1 card a turn.', { reveal: (g, c) => { g.maxEnergy[c.side] += 1; } }),
  Wiccan: M('+2 max energy if you spent all energy every turn before.', { reveal: (g, c) => { let all = true; for (let t = 1; t < g.turn; t++) if (!g.spentAll(c.side, t)) all = false; if (all) g.maxEnergy[c.side] += 2; } }),
  FallenOne: M('Sets your max energy to its Power.', { reveal: (g, c) => { g.maxEnergy[c.side] += Math.max(0, g.power(c) - (g.turn + g.maxEnergy[c.side])); } }),
  HopeSummers: M('+1 energy next turn after you play a card here.', { allyPlayedHere: (g, c) => g.addEnergy(c.side, g.turn + 1, 1) }),
  StarlordMasterOfTheSun: M('+1 energy next turn per turn ended with unspent energy.', { reveal: (g, c) => { let n = 0; for (let t = 1; t < g.turn; t++) if (!g.spentAll(c.side, t)) n++; g.addEnergy(c.side, g.turn + 1, n); } }),
  Arishem: M('+1 max energy on turn 3 (its extra deck cards aren’t simulated).', { sot: (g, c) => { if (g.turn === 3) g.maxEnergy[c.side] += 1; } }),
  SuperiorSpiderMan: M('+1 energy each turn while you have a buffed card in play.', { sot: (g, c) => { if (allies(g, c).some((x) => g.power(x) > g.info(x).power)) g.addEnergy(c.side, g.turn, 1); } }),
  Sunspot: M('End of turn: +1 per unspent energy.', { eot: (g, c) => g.buff(c, Math.max(0, g.energyFor(c.side, g.turn) - (g.spent[c.side][g.turn] || 0))) }),
  Speed: M('+1 for each turn you spent all your energy.', { ongoing: (g, c, add) => { let n = 0; for (let t = 1; t <= g.turn; t++) if (g.spentAll(c.side, t)) n++; add(c, n); } }),
  RedHulk: M('End of turn: +3 if the opponent has unspent energy.', { eot: (g, c) => { const s = other(c.side); if ((g.spent[s][g.turn] || 0) < g.energyFor(s, g.turn)) g.buff(c, 3); } }),
  Moondragon: M('End of turn: +2 if you played 1 card and spent all energy.', { eot: (g, c) => { if (g.playedThisTurn(c.side).length === 1 && g.spentAll(c.side, g.turn)) g.buff(c, 2); } }),
  Havok: M('End of turn: +3, and you lose 1 max energy.', { eot: (g, c) => { g.buff(c, 3); g.maxEnergy[c.side] -= 1; } }),
  Kraglin: M('Banishes your top card: +2 energy next turn if 4+ Cost, else +4 Power.', { reveal: (g, c) => { const k = deck(g, c.side).shift(); if (!g.sim) return g.buff(c, 2); if (k && k.cost >= 4) g.addEnergy(c.side, g.turn + 1, 2); else g.buff(c, 4); } }),

  // ---- Cost cheats and play rules -------------------------------------------
  Death: M('Costs 1 less per card destroyed this game.', { cost: (g, side, k, cost) => cost - g.destroyedCount }),
  Sasquatch: M('Costs 1 less per card you played last turn.', { cost: (g, side, k, cost) => cost - g.board.filter((x) => x.side === side && !x.created && x.turn === g.turn - 1).length }),
  Mockingbird: M('Costs 1 less per created card you have in play.', { cost: (g, side, k, cost) => cost - g.active().filter((x) => x.side === side && x.created).length }),
  SheHulk: M('Costs 1 less per unspent energy last turn.', { cost: (g, side, k, cost) => cost - Math.max(0, g.energyFor(side, g.turn - 1) - (g.spent[side][g.turn - 1] || 0)) }),
  Stature: M('Costs 1 if the opponent discarded this game.', { cost: (g, side, k, cost) => (g.discards[other(side)] ? 1 : cost) }),
  Skaar: M('Costs 2 less per card you have with 10+ Power.', { cost: (g, side, k, cost) => cost - 2 * g.active().filter((x) => x.side === side && g.power(x) >= 10).length }),
  WilsonFisk: M('Costs 3 if you have the highest Power card in play.', { cost: (g, side, k, cost) => { const top = g.active().sort(byPower(g))[0]; return top && top.side === side ? 3 : cost; } }),
  MilesMorales: M('Costs 1 if a card moved last turn.', { cost: (g, side, k, cost) => (g.board.some((x) => x.movedTurn === g.turn - 1) ? 1 : cost) }),
  MonstroOctopus: M('Costs less by the Cost of your deck’s top card.', { cost: (g, side, k, cost) => cost - (g.deck(side)[0]?.cost || 0) }),
  GhostThunderbolts: M('Costs 1 less per location you’re losing.', { cost: (g, side, k, cost) => cost - [0, 1, 2].filter((l) => sideTotal(g, l, side) < sideTotal(g, l, other(side))).length }),
  Infinaut: M('Can’t be played if you played a card last turn.', { canPlay: (g, side) => !g.board.some((x) => x.side === side && !x.created && x.turn === g.turn - 1) }),
  Giganto: M('Only playable at the left location.', { canPlay: (g, side, lane) => lane === 0 }),
  Crossbones: M('Only playable where you’re winning.', { canPlay: (g, side, lane) => winningAt(g, lane, side) }),
  Ikari: M('Only playable where an enemy card is afflicted.', { canPlay: (g, side, lane) => g.at(lane, other(side)).some((x) => x.buff < 0) }),
  CullObsidian: M('Only playable where you have a 1-Cost card.', { canPlay: (g, side, lane) => g.at(lane, side).some((x) => g.info(x).cost === 1) }),
  WinterSoldierThunderbolts: M('Only playable where you’re losing.', { canPlay: (g, side, lane) => sideTotal(g, lane, side) < sideTotal(g, lane, other(side)) }),
  Sentry: M('Can’t be played at the right location; adds a −9 Void there.', { canPlay: (g, side, lane) => lane !== 2, reveal: (g, c) => { if (c.lane < 2) g.spawn(c.side, 'TheVoid', 2, -9, c.uid); } }),
  EbonyMaw: M('Can’t be played after turn 3; you can’t play cards here.', { canPlay: (g) => g.turn <= 3 }),
  Storm: M('Floods this location: next turn is the last turn to play here.', { reveal: (g, c) => { g.flooded = g.flooded || {}; g.flooded[c.lane] = g.turn + 1; } }),
  Magik: M('Turns this location into Limbo: the game lasts until turn 7.', { reveal: (g, c) => { if (g.turn <= 5) { g.locs[c.lane] = 'Limbo'; g.lastTurn = 7; } } }),
  Domino: M('Always drawn on turn 2 (in playouts).'),
  Quicksilver: M('Starts in the opening hand (in playouts).'),

  // ---- Cost rules handled in the engine's cost calculation ---------------------
  Sera: M('Cards in your hand cost 1 less (minimum 1).'),
  Quinjet: M('Your created cards cost 1 less (minimum 1).'),
  RavonnaRenslayer: M('Your cards with 1 or less Power cost 1 less (minimum 1).'),
  MobiusMMobius: M('Your costs can’t go up; the opponent’s can’t go down.'),
  Gorgon: M('The opponent’s created cards cost 1 more.'),
  MrNegative: M('Swaps Power and Cost of the cards in your deck.', { reveal: (g, c) => deck(g, c.side).forEach((k) => { [k.cost, k.power] = [Math.max(0, k.power), k.cost]; }) }),
  RogueScionOfDivision: M('Steals the text of the most expensive card in their hand.', { reveal: (g, c) => { const k = hand(g, other(c.side)).slice().sort((a, b) => b.cost - a.cost)[0]; if (k) { k.silenced = true; c.texts = [k.id]; g.runReveal(c); } } }),

  // ---- Thanos and the Infinity Stones (shuffled in at game start in playouts) ---
  Thanos: M('Shuffles the six Infinity Stones into your deck (in playouts).'),
  SpaceStone: M('Draws Thanos.', { reveal: (g, c) => g.draw(c.side, (k) => k.id === 'Thanos') }),
  MindStone: M('Draws 2 Stones.', { reveal: (g, c) => { g.draw(c.side, (k) => /Stone$/.test(k.id)); g.draw(c.side, (k) => /Stone$/.test(k.id)); } }),
  SoulStone: M('Draws a card; Thanos can’t be destroyed.', { reveal: (g, c) => g.draw(c.side) }),
  TimeStone: M('Draws a card; Thanos costs 1 less.', { reveal: (g, c) => { g.draw(c.side); [...hand(g, c.side), ...deck(g, c.side)].forEach((k) => { if (k.id === 'Thanos') k.cost = Math.max(0, k.cost - 1); }); } }),
  PowerStone: M('Thanos has +10 once all six Stones are played.', { ongoing: (g, c, add) => { const stones = new Set(g.board.filter((x) => x.side === c.side && /Stone$/.test(x.id) && !x.created).map((x) => x.id)); if (stones.size >= 6) g.active().filter((x) => x.side === c.side && x.id === 'Thanos').forEach((x) => add(x, 10)); } }),
  RealityStone: M('Changes this location (pick the new one).'),

  // ---- Game Start cards (visible from the start: log them, or they come with your deck) ----
  HighEvolutionary: M('Game Start: your no-ability cards (Hulk, Cyclops, Misty Knight, Shocker, The Thing, Abomination, Wasp) get their evolved abilities.'),
  EvolvedWasp: M('Evolved: −1 to an enemy card here.', { reveal: (g, c) => { const t = enemy(g, c).sort(byPower(g))[0]; if (t) g.buff(t, -1); } }),
  EvolvedTheThing: M('Evolved: −1 to 3 enemy cards here.', { reveal: (g, c) => enemy(g, c).slice(0, 3).forEach((x) => g.buff(x, -1)) }),
  EvolvedShocker: M('Evolved: leftmost card in hand costs 1 less.', { reveal: (g, c) => { const k = hand(g, c.side)[0]; if (k) k.cost = Math.max(0, k.cost - 1); } }),
  EvolvedMistyKnight: M('Evolved: end of turn with unspent energy, +1 to another of your cards.', { eot: (g, c) => { if (!g.spentAll(c.side, g.turn)) { const t = allies(g, c).sort(byPower(g))[0]; if (t) g.buff(t, 1); } } }),
  EvolvedCyclops: M('Evolved: end of turn with unspent energy, −1 to 2 enemy cards here.', { eot: (g, c) => { if (!g.spentAll(c.side, g.turn)) enemy(g, c).slice(0, 2).forEach((x) => g.buff(x, -1)); } }),
  EvolvedHulk: M('Evolved: end of turn with unspent energy, +2 (in hand too).', { eot: (g, c) => { if (!g.spentAll(c.side, g.turn)) g.buff(c, 2); } }),
  EvolvedAbomination: M('Evolved: costs 1 less per afflicted enemy card in play.', { cost: (g, side, k, cost) => cost - g.active().filter((x) => x.side !== side && x.buff < 0).length }),
  Agamotto: M('Game Start: shuffles 4 Ancient Arcana into your deck (in playouts).'),
  Spell01Agamotto: M('−5 to an enemy card here and moves it right.', { reveal: (g, c) => { const t = enemy(g, c).sort(byPower(g))[0]; if (t) { g.buff(t, -5); if (c.lane < 2) g.move(t, c.lane + 1); } } }),
  Spell02Agamotto: M('Agamotto +3 (to hand if he’s not in play).', { reveal: (g, c) => { const a = allies(g, c).find((x) => x.id === 'Agamotto'); if (a) return g.buff(a, 3); const k = [...hand(g, c.side), ...deck(g, c.side)].find((x) => x.id === 'Agamotto'); if (k) { k.power += 3; if (deck(g, c.side).includes(k)) { deck(g, c.side).splice(deck(g, c.side).indexOf(k), 1); hand(g, c.side).push(k); } } } }),
  Spell03Agamotto: M('Your other cards here become copies of the strongest.', { reveal: (g, c) => { const here = mine(g, c); const top = here.sort(byPower(g))[0]; if (top) here.forEach((x) => { if (x !== top) { x.id = top.id; x.base = top.base; x.buff = top.buff; } }); } }),
  Spell04Agamotto: M('+4 energy next turn.', { reveal: (g, c) => g.addEnergy(c.side, g.turn + 1, 4) }),
  Dormammu: M('Game Start: Summoning Ritual step 1 in hand (in playouts).'),
  SummoningRitual01Dormammu: M('Ritual 1: merges your strongest destroyed card into Dormammu.', { reveal: (g, c) => { const d = g.board.filter((x) => x.side === c.side && x.gone === 'destroyed').sort((a, b) => g.power(b) - g.power(a))[0]; if (!d) return; const k = [...hand(g, c.side), ...deck(g, c.side)].find((x) => x.id === 'Dormammu'); if (k) k.power += g.power(d); g.addToHand(c.side, 'SummoningRitual02Dormammu', { created: true }); } }),
  SummoningRitual02Dormammu: M('Ritual 2: Dormammu steals 1 Power from each card here.', { reveal: (g, c) => { const others = g.at(c.lane).filter((x) => x !== c); others.forEach((x) => g.buff(x, -1)); const k = [...hand(g, c.side), ...deck(g, c.side)].find((x) => x.id === 'Dormammu'); if (k) k.power += others.length; g.addToHand(c.side, 'SummoningRitual03Dormammu', { created: true }); } }),
  SummoningRitual03Dormammu: M('Ritual 3: destroys 2 of your cards here to summon Dormammu here.', { reveal: (g, c) => { const two = mine(g, c).sort((a, b) => g.power(a) - g.power(b)).slice(0, 2); if (two.length < 2) return; two.forEach((x) => g.destroy(x)); const k = g.takeFrom(c.side, 'hand', (x) => x.id === 'Dormammu') || g.takeFrom(c.side, 'deck', (x) => x.id === 'Dormammu'); if (k) g.place(c.side, k, c.lane, c.uid); } }),
  ShangChiMasterOfTheRings: M('Game Start: the Ten Rings start in hand; on reveal they upgrade.', { reveal: (g, c) => hand(g, c.side).forEach((k) => { if (k.id === 'TenRings') { k.id = 'TenRingsUpgrade'; k.power += 1; } }) }),
  TenRings: M('+1 to one of your other cards here.', { reveal: (g, c) => { const t = mine(g, c).sort(byPower(g))[0]; if (t) g.buff(t, 1); } }),
  TenRingsUpgrade: M('End of turn: your other cards here +1.', { eot: (g, c) => mine(g, c).forEach((x) => g.buff(x, 1)) }),
  Hulkling: M('Game Start: copies a random 6-Cost’s text (sampled in playouts; set it on the board when you see it).'),
  Kang: M('Game Start: becomes 4 Kangs with random 3+ Cost text (sampled in playouts; set each on the board).'),
  Arishem: M('Game Start: 12 random cards in your deck (in playouts); +1 max energy on turn 3.', { sot: (g, c) => { if (g.turn === 3) g.maxEnergy[c.side] += 1; } }),
  Uatu: M('Game Start: sees the unrevealed locations (no board effect).'),

  // ---- Hand or deck onto the board (uses the predicted deck on the live board)
  AntiPolarMagneto: M('Adds a 3 or 4-Cost card from hand to each other location (likely cards on the live board).', { reveal: (g, c) => [0, 1, 2].filter((l) => l !== c.lane).forEach((l) => { if (!g.full(l, c.side)) g.place(c.side, g.takeFrom(c.side, 'hand', (k) => k.cost === 3 || k.cost === 4), l, c.uid); }) }),
  Jubilee: M('Adds the top card of your deck here (likely card on the live board).', { reveal: (g, c) => g.place(c.side, g.takeFrom(c.side, 'deck'), c.lane, c.uid) }),
  JubileeXMen: M('Adds the top card of your deck here with Power = unspent energy.', { reveal: (g, c) => { const k = g.takeFrom(c.side, 'deck'); if (k) g.place(c.side, { ...k, power: Math.max(0, g.energyFor(c.side, g.turn) - (g.spent[c.side][g.turn] || 0)) }, c.lane, c.uid); } }),
  DragonLord: M('Puts a card from your hand here (likely card on the live board).', { reveal: (g, c) => g.place(c.side, g.takeFrom(c.side, 'hand', (k) => k.power > 0), c.lane, c.uid) }),
  Malekith: M('Adds a 3-Cost or less card from your deck here.', { reveal: (g, c) => g.place(c.side, g.takeFrom(c.side, 'deck', (k) => k.cost <= 3), c.lane, c.uid) }),
  BaronZemo: M('Recruits the cheapest card from their deck to your side here.', { reveal: (g, c) => { const k = g.takeFrom(other(c.side), 'deck', null); if (k) g.place(c.side, k, c.lane, c.uid); } }),
  DoctorOctopus: M('Pulls the weakest card in their hand to their side here.', { reveal: (g, c) => { const k = g.takeFrom(other(c.side), 'hand', null); if (k) g.place(other(c.side), k, c.lane, c.uid); } }),
  Gladiator: M('Adds a card from their deck to their side here; destroys it if weaker.', { reveal: (g, c) => { const k = g.takeFrom(other(c.side), 'deck'); const t = g.place(other(c.side), k, c.lane, c.uid); if (t && g.power(t) < g.power(c)) g.destroy(t); } }),
  UltronTimeStone: M('Puts a card from your hand here.', { reveal: (g, c) => g.place(c.side, g.takeFrom(c.side, 'hand'), c.lane, c.uid) }),
  Blob: M('Merges cards from your deck until it gains 13+ Power.', { reveal: (g, c) => { if (!g.sim) return g.buff(c, 14); let gained = 0; while (gained < 13 && deck(g, c.side).length) gained += Math.max(0, deck(g, c.side).shift().power); g.buff(c, gained); } }),
  Random: M('Gets the Power of a random card in your deck.', { reveal: (g, c) => { const d = deck(g, c.side); g.setPower(c, g.sim && d.length ? d[Math.floor(g.rand() * d.length)].power : Math.round(g.avgPower(3))); } }),
  IronLad: M('Copies the text of your deck’s top card.', { reveal: (g, c) => { const k = g.sim ? deck(g, c.side)[0] : null; if (k) { c.texts = [k.id]; g.runReveal(c); } } }),
  Ares: M('+6 if your top 3 deck cards out-power theirs.', { reveal: (g, c) => { if (!g.sim) return g.buff(c, 3); const sum = (s) => deck(g, s).slice(0, 3).reduce((a, k) => a + k.power, 0); if (sum(c.side) > sum(other(c.side))) g.buff(c, 6); } }),
};
