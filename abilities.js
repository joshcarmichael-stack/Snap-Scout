// Card abilities the board engine applies. Hooks (all optional):
//   reveal(g, c)                  On Reveal (repeated by Wong, blocked by Cosmo…)
//   ongoing(g, c, add)            live effect; call add(card, n) for each card it buffs
//   move(g, c, from, to, cause)   when this card moves
//   destroyed(g, c)               when this card is destroyed
//   eot(g, c)                     end of each turn
//   allyPlayedHere(g, c, played)  when you play another card at this card's location
//   kind / note                   how the app labels it (see KIND_LABEL in locations.js)
//
// Choices the real player makes ("one of your cards") pick the strongest
// option; random targets use the expected value where that's simple.
// Cards with no entry: vanilla cards count printed power exactly; other cards
// count printed power and are flagged "ability not modelled".

const mine = (g, c) => g.at(c.lane, c.side).filter((x) => x !== c);
const enemy = (g, c) => g.at(c.lane, c.side === 'me' ? 'opp' : 'me');
const byPower = (g) => (a, b) => g.power(b) - g.power(a);
const pend = (g, c, label, fn) => g.pending.push({ side: c.side, src: c.uid, label, fn });
const none = (note) => ({ kind: 'none', note });

export const ABILITIES = {
  // ---- Power changes --------------------------------------------------------
  BlackPanther: { kind: 'modelled', note: 'Doubles its Power on reveal.', reveal: (g, c) => g.buff(c, g.power(c)) },
  Ironheart: { kind: 'approx', note: 'Gives your two strongest other cards +3.', reveal: (g, c) => g.active().filter((x) => x.side === c.side && x !== c).sort(byPower(g)).slice(0, 2).forEach((x) => g.buff(x, 3)) },
  SilverSurfer: { kind: 'modelled', note: 'Your other 3-Cost cards in play get +2.', reveal: (g, c) => g.active().filter((x) => x.side === c.side && x !== c && g.info(x).cost === 3).forEach((x) => g.buff(x, 2)) },
  KarenPage: { kind: 'approx', note: 'One each of your 1, 2 and 3-Cost cards in play gets +2.', reveal: (g, c) => [1, 2, 3].forEach((cost) => g.active().filter((x) => x.side === c.side && x !== c && g.info(x).cost === cost).sort(byPower(g)).slice(0, 1).forEach((x) => g.buff(x, 2))) },
  Hazmat: { kind: 'modelled', note: 'All other cards get −1.', reveal: (g, c) => g.active().filter((x) => x !== c).forEach((x) => g.buff(x, -1)) },
  JaneFosterFracturedFrontier: {
    kind: 'approx', note: 'Judges 4 random cards: averaged over the board.',
    reveal: (g, c) => {
      const others = g.active().filter((x) => x !== c);
      const share = others.length ? Math.min(1, 4 / others.length) : 0;
      others.forEach((x) => g.buff(x, x.side === c.side ? share : -share));
    },
  },
  ShadowKing: { kind: 'modelled', note: 'Resets cards here to printed Power.', reveal: (g, c) => g.at(c.lane).forEach((x) => { x.buff = 0; }) },
  RedGuardian: {
    kind: 'modelled', note: 'Lowest enemy card here: −2 and loses its text.',
    reveal: (g, c) => { const t = enemy(g, c).sort((a, b) => g.power(a) - g.power(b))[0]; if (t) { g.buff(t, -2); t.silenced = true; } },
  },
  Brood: { kind: 'modelled', note: 'Adds 2 Broodlings here with the same Power.', reveal: (g, c) => { for (let i = 0; i < 2; i++) g.spawn(c.side, 'Broodling', c.lane, g.power(c), c.uid); } },
  DrDoom: { kind: 'modelled', note: 'Adds a 5-Power DoomBot to each other location.', reveal: (g, c) => [0, 1, 2].filter((l) => l !== c.lane).forEach((l) => g.spawn(c.side, 'DoomBot', l, 5, c.uid)) },
  LunaSnow: { kind: 'modelled', note: 'Adds an Ice Cube to each side here.', reveal: (g, c) => { g.spawn('me', 'IceCube', c.lane, null, c.uid); g.spawn('opp', 'IceCube', c.lane, null, c.uid); } },

  // ---- Destroy ------------------------------------------------------------
  Venom: { kind: 'modelled', note: 'Destroys your other cards here and gains their Power.', reveal: (g, c) => mine(g, c).forEach((x) => { const p = g.power(x); if (g.destroy(x)) g.buff(c, p); }) },
  Carnage: { kind: 'modelled', note: 'Destroys your other cards here, +2 each.', reveal: (g, c) => mine(g, c).forEach((x) => { if (g.destroy(x)) g.buff(c, 2); }) },
  Deathlok: { kind: 'modelled', note: 'Destroys your other cards here.', reveal: (g, c) => mine(g, c).forEach((x) => g.destroy(x)) },
  Killmonger: { kind: 'modelled', note: 'Destroys all 1-Cost cards.', reveal: (g, c) => g.active().filter((x) => x !== c && g.info(x).cost === 1).forEach((x) => g.destroy(x)) },
  ShangChi: { kind: 'modelled', note: 'Destroys an enemy card here with 10+ Power.', reveal: (g, c) => { const t = enemy(g, c).filter((x) => g.power(x) >= 10).sort(byPower(g))[0]; if (t) g.destroy(t); } },
  ArnimZola: {
    kind: 'modelled', note: 'Destroys your strongest other card here and copies it to the other locations.',
    reveal: (g, c) => {
      const t = mine(g, c).sort(byPower(g))[0];
      if (!t) return;
      const snapshot = { ...t };
      if (!g.destroy(t)) return;
      [0, 1, 2].filter((l) => l !== c.lane).forEach((l) => g.copy(snapshot, l));
    },
  },
  FastballSpecial: {
    kind: 'modelled', note: 'Destroys your strongest card here; an enemy card here gets that much −Power.',
    reveal: (g, c) => {
      const t = mine(g, c).sort(byPower(g))[0];
      const e = enemy(g, c).sort(byPower(g))[0];
      if (!t) return;
      const p = g.power(t);
      if (g.destroy(t) && e) g.buff(e, -p);
    },
  },
  Deadpool: { kind: 'modelled', note: 'Returns to hand with double Power when destroyed.', destroyed: (g, c) => { c.gone = 'hand'; } },
  Wolverine: {
    kind: 'approx', note: 'Regenerates with +2 at another location when destroyed.',
    destroyed: (g, c) => { const l = [0, 1, 2].filter((x) => !g.full(x, c.side)).sort((a, b) => g.at(a, c.side).length - g.at(b, c.side).length)[0]; const k = g.copy(c, l); if (k) { g.buff(k, 2); k.created = false; } },
  },
  X23: {
    kind: 'approx', note: 'Regenerates at another location when destroyed.',
    destroyed: (g, c) => { const l = [0, 1, 2].filter((x) => !g.full(x, c.side)).sort((a, b) => g.at(a, c.side).length - g.at(b, c.side).length)[0]; const k = g.copy(c, l); if (k) k.created = false; },
  },
  Knull: { kind: 'modelled', note: 'Has the Power of everything destroyed this game.', ongoing: (g, c, add) => add(c, g.destroyedPower) },
  Armor: { kind: 'modelled', note: 'Cards here can’t be destroyed.' },

  // ---- Moving -----------------------------------------------------------
  HumanTorch: { kind: 'modelled', note: 'Doubles its Power every time it moves.', move: (g, c) => g.buff(c, g.power(c)) },
  MultipleMan: { kind: 'modelled', note: 'Leaves a copy behind when it moves.', move: (g, c, from) => g.copy(c, from) },
  Vulture: { kind: 'modelled', note: '+4 every time it moves.', move: (g, c) => g.buff(c, 4) },
  Dagger: { kind: 'modelled', note: '+2 for each enemy card where it moves to.', move: (g, c) => g.buff(c, 2 * enemy(g, c).length) },
  SpiderManBrandNewDay: { kind: 'approx', note: 'After moving, your strongest other card there gets +1.', move: (g, c) => { const t = mine(g, c).sort(byPower(g))[0]; if (t) g.buff(t, 1); } },
  IronFist: { kind: 'modelled', note: 'Your next card moves one location left.', reveal: (g, c) => pend(g, c, 'Iron Fist: next card moves left', (g2, played) => g2.move(played, played.lane - 1)) },
  GhostSpider: { kind: 'modelled', note: 'The last card you played moves here.', reveal: (g, c) => { const t = g.lastPlayed[c.side]; if (t && t !== c) g.move(t, c.lane); } },
  Heimdall: { kind: 'modelled', note: 'Your other cards move one location left.', reveal: (g, c) => g.active().filter((x) => x.side === c.side && x !== c).sort((a, b) => a.lane - b.lane).forEach((x) => g.move(x, x.lane - 1)) },
  DoctorStrange: {
    kind: 'modelled', note: 'Your highest-Power card(s) move here.',
    reveal: (g, c) => { const own = g.active().filter((x) => x.side === c.side && x !== c); const top = Math.max(...own.map((x) => g.power(x))); own.filter((x) => g.power(x) === top).forEach((x) => g.move(x, c.lane)); },
  },
  Polaris: { kind: 'modelled', note: 'Pulls an enemy 1 or 2-Cost card here.', reveal: (g, c) => { const t = g.active().filter((x) => x.side !== c.side && x.lane !== c.lane && g.info(x).cost <= 2).sort(byPower(g))[0]; if (t) g.move(t, c.lane); } },
  Magneto: { kind: 'modelled', note: 'Pulls enemy 3 and 4-Cost cards here.', reveal: (g, c) => g.active().filter((x) => x.side !== c.side && x.lane !== c.lane && [3, 4].includes(g.info(x).cost)).forEach((x) => g.move(x, c.lane)) },
  Juggernaut: { kind: 'approx', note: 'Moves enemy cards played here this turn to the next location.', reveal: (g, c) => enemy(g, c).filter((x) => x.turn === g.turn).forEach((x) => g.move(x, c.lane === 2 ? 1 : c.lane + 1)) },
  GrandMaster: {
    kind: 'approx', note: 'Moves your best other On Reveal card here to the middle and repeats it.',
    reveal: (g, c) => { const t = mine(g, c).filter((x) => g.abilityOf(x)?.reveal).sort(byPower(g))[0]; if (t) { g.move(t, 1); g.reveal(t); } },
  },
  Nightcrawler: { kind: 'modelled', note: 'Moveable once: tap it on the board to move it.' },
  Vision: { kind: 'modelled', note: 'Moveable: tap it on the board to move it.' },
  CaptainMarvel: { kind: 'approx', note: 'Moves to a winning location at game end (used in the win chance).' },

  // ---- Repeat / copy text ------------------------------------------------
  Wong: { kind: 'modelled', note: 'Your On Reveals here happen twice.' },
  Odin: { kind: 'modelled', note: 'Repeats the On Reveals of your other cards here.', reveal: (g, c) => mine(g, c).forEach((x) => g.runReveal(x)) },
  Cosmo: { kind: 'modelled', note: 'On Reveals here don’t happen.' },
  Onslaught: { kind: 'modelled', note: 'Your other Ongoing effects here apply twice.' },
  Mystique: {
    kind: 'modelled', note: 'Copies the Ongoing of the last card you played.',
    reveal: (g, c) => { const t = g.lastPlayed[c.side]; if (t && t !== c && /Ongoing/.test(g.info(t).ability || '')) c.copiedText = t.copiedText || t.id; },
  },
  AbsorbingMan: {
    kind: 'modelled', note: 'Copies the On Reveal of the last card you played.',
    reveal: (g, c) => { const t = g.lastPlayed[c.side]; const ab = t && t !== c && g.abilityOf(t); if (ab?.reveal) g.runReveal(t, ab, c); },
  },
  Enchantress: { kind: 'modelled', note: 'Removes Ongoing abilities here.', reveal: (g, c) => g.at(c.lane).forEach((x) => { if (x !== c && /Ongoing/.test(g.info(x).ability || '')) x.silenced = true; }) },
  Rogue: {
    kind: 'modelled', note: 'Steals an enemy Ongoing here.',
    reveal: (g, c) => { const t = enemy(g, c).find((x) => !x.silenced && /Ongoing/.test(g.info(x).ability || '')); if (t) { c.copiedText = t.copiedText || t.id; t.silenced = true; } },
  },

  // ---- Ongoing -----------------------------------------------------------
  BlueMarvel: { kind: 'modelled', note: 'Your other cards have +1.', ongoing: (g, c, add) => g.active().filter((x) => x.side === c.side && x !== c).forEach((x) => add(x, 1)) },
  KaZar: { kind: 'modelled', note: 'Your 1-Cost cards have +1.', ongoing: (g, c, add) => g.active().filter((x) => x.side === c.side && g.info(x).cost === 1).forEach((x) => add(x, 1)) },
  IronMan: { kind: 'modelled', note: 'Doubles your total Power here.' },
  Dazzler: { kind: 'modelled', note: '+2 for each location full on your side.', ongoing: (g, c, add) => add(c, 2 * [0, 1, 2].filter((l) => g.full(l, c.side)).length) },
  Gorr: { kind: 'modelled', note: '+2 for each On Reveal card in play.', ongoing: (g, c, add) => add(c, 2 * g.active().filter((x) => /On Reveal/.test(g.info(x).ability || '')).length) },
  Cerebro: {
    kind: 'modelled', note: 'Your highest-Power cards have +3.',
    ongoing: (g, c, add) => { const own = g.active().filter((x) => x.side === c.side && x !== c); const top = Math.max(...own.map((x) => g.power(x))); own.filter((x) => g.power(x) === top).forEach((x) => add(x, 3)); },
  },
  JeffTheBabyDolphin: { kind: 'modelled', note: 'Your cards played here get +1.', allyPlayedHere: (g, c, played) => g.buff(played, 1) },
  ElsaBloodstone: { kind: 'modelled', note: 'Cards that fill your side of a location get +2.', allyPlayedHere: (g, c, played) => { if (g.at(played.lane, played.side).length === 4) g.buff(played, 2); } },
  LukeCage: { kind: 'approx', note: 'Front-row cards can’t be reduced; not applied.' },
  Speed: { kind: 'approx', note: '+1 per turn you spent all energy; not tracked.' },
  SuperiorIronMan: { kind: 'approx', note: 'Doubles Power increases to itself; not applied.' },
  ScorpionBrandNewDay: { kind: 'approx', note: 'Doubles Power reductions on enemies; not applied.' },

  // ---- "Next card" effects -------------------------------------------------
  Forge: { kind: 'modelled', note: 'Your next card gets +2.', reveal: (g, c) => pend(g, c, 'Forge: next card +2', (g2, p) => g2.buff(p, 2)) },
  Stick: { kind: 'modelled', note: 'Your next card gets this card’s Power.', reveal: (g, c) => { const n = g.power(c); pend(g, c, `Stick: next card +${n}`, (g2, p) => g2.buff(p, n)); } },
  Shuri: { kind: 'modelled', note: 'Doubles your next card if it’s played here.', reveal: (g, c) => pend(g, c, 'Shuri: next card here doubles', (g2, p) => { if (p.lane === c.lane) g2.buff(p, g2.power(p)); }) },
  Agony: { kind: 'modelled', note: 'Merges into your next card played here.', allyPlayedHere: (g, c, played) => { if (c.gone) return; g.buff(played, g.power(c)); c.gone = 'merged'; } },

  // ---- End of turn -------------------------------------------------------
  Isca: { kind: 'modelled', note: 'End of turn: doubles if losing here.', eot: (g, c) => { g.computeLive(); if (g.sideTotal(c.lane, c.side) < g.sideTotal(c.lane, c.side === 'me' ? 'opp' : 'me')) g.buff(c, g.power(c)); } },
  AdamWarlock: { kind: 'modelled', note: 'End of turn: +1 unless winning here.', eot: (g, c) => { g.computeLive(); if (g.sideTotal(c.lane, c.side) <= g.sideTotal(c.lane, c.side === 'me' ? 'opp' : 'me')) g.buff(c, 1); } },
  HumanTorchFirstSteps: { kind: 'approx', note: 'End of turn: +1 (or doubles once with a full side).', eot: (g, c) => { if (!c.doubled && g.full(c.lane, c.side)) { c.doubled = true; g.buff(c, g.power(c)); } else g.buff(c, 1); } },
  MarvelBoy: { kind: 'modelled', note: 'End of turn: three of your 1-Costs get +1.', eot: (g, c) => g.active().filter((x) => x.side === c.side && g.info(x).cost === 1).slice(0, 3).forEach((x) => g.buff(x, 1)) },
  HellcowFracturedFrontier: {
    kind: 'modelled', note: 'End of turn: all other cards here −1; destroys your own at 0 or less.',
    eot: (g, c) => { g.at(c.lane).forEach((x) => { if (x !== c) g.buff(x, -1); }); g.computeLive(); mine(g, c).forEach((x) => { if (g.power(x) <= 0) g.destroy(x); }); },
  },
  Sunspot: { kind: 'approx', note: 'Gains Power from unspent energy; adjust its power by hand.' },

  // ---- Not on the board (hand, deck, energy, cost) -----------------------
  Surge: none('Buffs the top card of your deck.'),
  Domino: none('Always drawn on turn 2.'),
  PsylockeFracturedFrontier: none('Reduces costs in hand.'),
  AmericaChavez: none('Buffs the top card of your deck.'),
  Quicksilver: none('Starts in the opening hand.'),
  MajesticWingbeat: none('Buffs a card in hand.'),
  Scorpion: none('Afflicts cards in the opponent’s hand.'),
  Sera: none('Cards in hand cost 1 less.'),
  Quinjet: none('Created cards cost 1 less.'),
  MobiusMMobius: none('Stops cost changes.'),
  Cable: none('Draws from the opponent’s deck.'),
  KingEitri: none('Draws a created card.'),
  Iceman: none('Raises a cost in the opponent’s hand.'),
  Crystal: none('Both players draw.'),
  Valentina: none('Adds a card to hand.'),
  Wave: none('Caps costs at 4.'),
  MotherAskani: none('Copies a card in hand.'),
  Phastos: none('Changes cards in deck.'),
  HighEvolutionary: none('Upgrades vanilla cards for the game.'),
  MrFantasticFirstSteps: none('Buffs or discounts a card in hand.'),
  Zabu: none('Discounts 4-Costs in deck.'),
  MrNegative: none('Swaps Power and Cost in deck.'),
  LadySif: none('Discards from hand.'),
  Blade: none('Discards from hand.'),
  CassandraNova: none('Steals Power from the opponent’s deck.'),
  JaneFoster: none('Draws 0-Cost cards.'),
  MoonGirl: none('Copies your hand.'),
  ShadowlandsDaredevil: none('Shuffles Demons into the deck.'),
  Psylocke: none('+1 energy next turn.'),
  Wiccan: none('+2 max energy if you spent everything.'),
  Electro: none('+1 max energy, one card a turn.'),
  Death: none('Costs less per destroyed card.'),
  Sasquatch: none('Costs less per card played last turn.'),
  Mockingbird: none('Costs less per created card.'),
  Infinaut: none('Can’t be played after a turn you played cards.'),
  Giganto: none('Only playable at the left location.'),
  Thanos: none('Infinity Stones in deck.'),
  ThanosFracturedFrontier: { kind: 'approx', note: 'Infinity Shots fire on reveal; enter their effects by hand.' },
  Magik: none('Turns a location into Limbo (pick Limbo in the lane).'),
  ScarletWitch: none('Changes a location (pick the new one).'),
  Legion: none('Changes locations (pick the new ones).'),
  Jubilee: { kind: 'approx', note: 'Adds the top card of the deck here: log it with "+ Add card".' },
  AntiPolarMagneto: { kind: 'approx', note: 'Adds 3/4-Costs from hand to other locations: log them with "+ Add card".' },
  Gambit: { kind: 'approx', note: 'Destroys a random enemy card: destroy it on the board.' },
  Blink: { kind: 'approx', note: 'Swaps your last card for one from your deck: edit it on the board.' },
  NicoMinoru: { kind: 'approx', note: 'Casts a spell on your next card; edit the result by hand.' },
  IronLad: { kind: 'approx', note: 'Copies the top card of the deck’s text; not applied.' },
  Gladiator: { kind: 'approx', note: 'Adds an enemy card from their deck: log it with "+ Add card".' },
  // ---- More meta cards ----------------------------------------------------
  AntMan: { kind: 'modelled', note: '+4 with a full side here.', ongoing: (g, c, add) => { if (g.full(c.lane, c.side)) add(c, 4); } },
  Kraven: { kind: 'modelled', note: '+2 when a card moves here.', moveIn: true },
  Sage: { kind: 'modelled', note: '+2 for each different Power among other cards here.', reveal: (g, c) => g.buff(c, 2 * new Set(g.at(c.lane).filter((x) => x !== c).map((x) => g.power(x))).size) },
  SquirrelGirl: { kind: 'modelled', note: 'Adds a 1-Power Squirrel to each other location.', reveal: (g, c) => [0, 1, 2].filter((l) => l !== c.lane).forEach((l) => g.spawn(c.side, 'Squirrel', l, 1, c.uid)) },
  FinFangFoom: { kind: 'approx', note: 'Gains the Power of the strongest enemy card here.', reveal: (g, c) => { const t = enemy(g, c).sort(byPower(g))[0]; if (t) g.buff(c, g.power(t)); } },
  Hulkbuster: { kind: 'modelled', note: 'Merges into your strongest card here.', reveal: (g, c) => { const t = mine(g, c).sort(byPower(g))[0]; if (t) { g.buff(t, g.power(c)); c.gone = 'merged'; } } },
  AdamantiumInfusion: {
    kind: 'approx', note: 'Revives your strongest destroyed card here with double Power.',
    reveal: (g, c) => { const t = g.board.filter((x) => x.gone === 'destroyed' && x.side === c.side && x.lane === c.lane).sort((a, b) => g.power(b) - g.power(a))[0]; c.gone = 'banished'; if (t) { const k = g.copy(t, c.lane); if (k) g.buff(k, g.power(k)); } },
  },
  SamWilson: { kind: 'approx', note: 'Adds Cap’s Shield to another location.', reveal: (g, c) => { const l = [0, 1, 2].find((x) => x !== c.lane && !g.full(x, c.side)); if (l != null) g.spawn(c.side, 'CapsShield', l, null, c.uid); } },
  ZombieGiantMan: { kind: 'approx', note: 'Horde isn’t tracked; adjust its Power by hand.' },
  TheHunger: { kind: 'approx', note: 'Horde isn’t tracked.' },
  ZombieMisterFantastic: { kind: 'approx', note: 'Horde isn’t tracked.' },
  ZombieSentry: { kind: 'approx', note: 'Horde isn’t tracked.' },
  Galactus: { kind: 'approx', note: 'Can destroy the other locations; clear them when it happens.' },
  KittyPryde: { kind: 'approx', note: 'Returns to hand each turn; remove and replay it.' },
  Viv: { kind: 'approx', note: 'Moves if losing at start of turn; move it on the board.' },
  HydraBob: { kind: 'approx', note: 'Moves when someone snaps; move it on the board.' },
  AwesomeAndy: { kind: 'approx', note: 'Activate: +2 at each other location; adjust by hand when used.' },
  SymbioteSpiderMan: { kind: 'approx', note: 'Activate: merges a card here; adjust by hand when used.' },
  Maverick: { kind: 'approx', note: 'Activate: next card gets its Power; adjust by hand.' },
  Prodigy: { kind: 'approx', note: 'Copies the text in front of it; not applied.' },
  Tarantula: { kind: 'approx', note: 'Grows at end of turn if highest Power; not applied.' },
  Morbius: { kind: 'approx', note: 'Grows with discards; adjust by hand.' },
  Dracula: { kind: 'approx', note: 'Gains a hand card’s Power at game end; not applied.' },
  TechnoOrganicVirus: { kind: 'approx', note: 'Replaces text of your other cards here; not applied.' },
  EnSabahNur: { kind: 'approx', note: 'Objective transform; adjust by hand.' },
  CalibanHorseman: { kind: 'approx', note: 'Objective: −7 to the highest-Cost enemy card; adjust by hand.' },
  SebastianShaw: { kind: 'approx', note: 'Empower bonus; adjust by hand.' },
  Venus: { kind: 'approx', note: 'Empower bonus; adjust by hand.' },
  Kluh: none('Discounts a card in each hand.'),
  RavonnaRenslayer: none('Low-Power cards cost less.'),
  RogueScionOfDivision: none('Steals text from a card in the opponent’s hand.'),
  SpiderHam: none('Changes a card in the opponent’s hand.'),
  IronPatriot: none('Adds a card to hand.'),
  Arishem: none('Extra cards and +1 max energy on turn 3.'),
  WarMachine: none('Lets you play anywhere.'),
  Lockjaw: none('Swaps your next card with one from the deck.'),
  Skaar: none('Costs less with 10+ Power cards.'),
  Merlin: none('Adds Incantations to hand.'),
  Modok: none('Discards your hand.'),
  TheAncientOne: none('Adds Tao Mandala to hand.'),
};
