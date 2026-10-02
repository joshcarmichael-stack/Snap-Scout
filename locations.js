// How Snap Scout treats every location when projecting the board.
//
// The lane totals you type in already include location effects on cards that
// are on the board, so what matters here is how a location changes:
//   - what the opponent can still add this turn (energy, costs, blocks, bonuses)
//   - what happens at the end of this turn (end-of-turn power changes)
//   - how the lane is scored (lowest power wins, doesn't count, card count)
//   - other lanes (Baxter Building style swings)
//
// Every released location has an entry with a `kind`:
//   modelled   the effect is applied exactly
//   approx     applied as an estimate (random or player-chosen outcomes)
//   symmetric  affects both sides about equally, so no net change is applied
//   none       doesn't change lane power (draws, discards, hand effects...)
//
// Optional hooks (all receive ctx, see laneCtx below):
//   power(card, ctx, n)   extra power for a card played here (n = cards played here this turn)
//   blocked(card, ctx)    card can't usefully be played here
//   capacity(ctx)         most cards the side can still add here
//   costMod(card, ctx)    cost change, applies at every lane
//   cardPower(card, ctx)  power change for cards in hand, applies at every lane
//   energy(ctx)           extra energy this turn for ctx.side
//   maxPlays(ctx)         most cards a player can play this turn, anywhere
//   blockOthers(ctx)      true if cards can only be played here this turn
//   eot(side, other, ctx) side's power after this turn's end-of-turn effect
//   scoring               'lowest' | 'ignored' | 'cards'
//   swing                 { amount, to: 'others' | 'adjacent' } winner-takes-bonus at other lanes
//   mirror                true: power added here also counts at the other lanes
//   endsAfter             the game ends after this turn

const all = () => true;
const none = (note) => ({ kind: 'none', note });
const sym = (note) => ({ kind: 'symmetric', note });
const onReveal = (ctx) => ctx.turn === ctx.reveal;

export const LOCATION_EFFECTS = {
  // ---- Power on play ----------------------------------------------------
  Nidavellir: { kind: 'modelled', note: 'Each card played here gets +5.', power: () => 5 },
  Xandar: { kind: 'modelled', note: 'Each card played here gets +1.', power: () => 1 },
  SewerSystem: { kind: 'modelled', note: 'Each card played here gets −1.', power: () => -1 },
  Necrosha: { kind: 'modelled', note: 'Each card played here gets −2.', power: () => -2 },
  NegativeZone: { kind: 'modelled', note: 'Each card played here gets −3.', power: () => -3 },
  Proscenium: { kind: 'modelled', note: 'Each card played here gets +2.', power: () => 2 },
  LakeHellas: { kind: 'modelled', note: '1-Cost cards played here get +2.', power: (c) => (c.cost === 1 ? 2 : 0) },
  WashingtonDC: { kind: 'modelled', note: 'Cards with no ability get +3 here.', power: (c) => (c.special ? 0 : 3) },
  Atlantis: { kind: 'modelled', note: 'A lone card here gets +5.', power: (c, ctx, n) => (ctx.side.cards === 0 && n === 1 ? 5 : 0) },
  JosiesBar: { kind: 'modelled', note: 'Two cards played here together get +2 each.', power: (c, ctx, n) => (n >= 2 ? 2 : 0) },
  ShurisLab: { kind: 'modelled', note: 'Cards played here have their Power doubled.', power: (c) => Math.max(0, c.power) },
  QuantumRealm: { kind: 'modelled', note: 'Cards played here become 2 Power.', power: (c) => 2 - c.power },
  Panoptichron: { kind: 'modelled', note: 'Created cards played here get +2.', power: (c) => (c.generated ? 2 : 0) },
  SmithsonianMuseum: { kind: 'approx', note: 'Ongoing cards played here get about +1 each.', power: (c) => (c.ongoing ? 1 : 0) },
  WakandanThroneRoom: { kind: 'approx', note: 'Assumes the opponent’s best card here becomes the highest and doubles.', power: (c, ctx, n) => (n === 1 ? Math.max(0, c.power) : 0) },
  BlackVortex: { kind: 'approx', note: 'The next card here becomes an average 6-Cost card.', power: (c, ctx) => Math.round(ctx.avgPower(6)) - c.power },
  Tarnax: { kind: 'approx', note: 'Cards here transform into an average card of the same Cost.', power: (c, ctx) => Math.round(ctx.avgPower(c.cost)) - c.power },
  BarSinister: { kind: 'approx', note: 'One card here fills the side with copies.', power: (c, ctx) => c.power * Math.max(0, 3 - ctx.side.cards), capacity: (ctx) => Math.min(1, 4 - ctx.side.cards) },
  MonsterMetropolis: { kind: 'approx', note: 'The +3 moves to whichever card is highest; treated as no net change.' },
  DangerRoom: { kind: 'approx', note: 'Cards here have a 25% chance to be destroyed; not discounted.' },
  Hospice: { kind: 'none', note: 'Doubles power changes; printed power is unaffected.' },

  // ---- Can't usefully play here ----------------------------------------
  Flooded: { kind: 'modelled', note: 'No cards can be played here.', blocked: all },
  SanctumSanctorum: { kind: 'modelled', note: 'No cards can be played here.', blocked: all },
  CrimsonCosmos: { kind: 'modelled', note: 'Cards costing 3 or less can’t be played here.', blocked: (c) => c.cost <= 3 },
  HellfireClub: { kind: 'modelled', note: '1-Cost cards can’t be played here.', blocked: (c) => c.cost === 1 },
  TheBigHouse: { kind: 'modelled', note: 'Cards costing 4+ can’t be played here.', blocked: (c) => c.cost >= 4 },
  PitOfExile: { kind: 'modelled', note: 'Cards with 10+ Power can’t be played here.', blocked: (c) => c.power >= 10 },
  Kyln: { kind: 'modelled', note: 'No plays here after turn 4.', blocked: (c, ctx) => ctx.turn > 4 },
  Vault: { kind: 'modelled', note: 'No plays here on turn 6.', blocked: (c, ctx) => ctx.turn === 6 },
  Flooding: { kind: 'modelled', note: 'No plays here after the turn it was revealed.', blocked: (c, ctx) => ctx.turn > ctx.reveal },
  MiniaturizedLab: { kind: 'modelled', note: 'No plays here on turns 3–5.', blocked: (c, ctx) => ctx.turn >= 3 && ctx.turn <= 5 },
  DeathsDomain: { kind: 'modelled', note: 'Cards played here are destroyed, so they add no power.', blocked: all },
  AltarOfDeath: { kind: 'modelled', note: 'Cards played here are destroyed (for energy next turn).', blocked: all },
  Vormir: { kind: 'approx', note: 'The next card played here is destroyed; assumes the opponent avoids it.', blocked: all },
  LukesBar: { kind: 'modelled', note: 'Cards played here return to hand, so they add no power.', blocked: all },
  CastleZemo: { kind: 'modelled', note: 'The next card played here switches sides; assumes the opponent avoids it.', blocked: all },
  AuntMays: { kind: 'approx', note: 'The next card played here moves away (+3); not counted here.', blocked: all },
  SpiderIsland: { kind: 'approx', note: 'Cards played here move away; not counted here.', blocked: all },
  SpaceThrone: { kind: 'modelled', note: 'Each player can have only one card here.', capacity: (ctx) => (ctx.side.cards ? 0 : 1) },
  RicketyBridge: { kind: 'approx', note: 'More than one card gets destroyed, so assumes one card at most.', capacity: (ctx) => (ctx.side.cards ? 0 : 1), eot: (s) => (s.cards > 1 ? 0 : s.power) },
  CollapsedMine: { kind: 'approx', note: 'Rocks fill this location; tap the card bars to mark full sides.' },
  Morag: { kind: 'approx', note: 'The first card each turn can’t go here; not enforced.' },
  BrooklynBridge: { kind: 'approx', note: 'Can’t play here two turns in a row; not tracked.' },

  // ---- Cost and energy ---------------------------------------------------
  Elysium: { kind: 'modelled', note: 'All cards cost 1 less.', costMod: () => -1 },
  Titan: { kind: 'modelled', note: '6-Cost cards cost 1 less.', costMod: (c) => (c.cost === 6 ? -1 : 0) },
  Utopia: { kind: 'modelled', note: '3 and 4-Cost cards cost 1 less.', costMod: (c) => (c.cost === 3 || c.cost === 4 ? -1 : 0) },
  DreamDimension: { kind: 'modelled', note: 'Cards cost 1 more on turn 5.', costMod: (c, ctx) => (ctx.turn === 5 ? 1 : 0) },
  TheSandbar: { kind: 'modelled', note: 'Created cards cost 1 more.', costMod: (c) => (c.generated && c.cost < 6 ? 1 : 0) },
  ProjectPegasus: { kind: 'modelled', note: '+5 energy the turn it reveals.', energy: (ctx) => (onReveal(ctx) ? 5 : 0) },
  TinkerersWorkshop: { kind: 'modelled', note: '+1 energy the turn it reveals.', energy: (ctx) => (onReveal(ctx) ? 1 : 0) },
  ParkerIndustries: { kind: 'modelled', note: '+2 energy but only one card the turn it reveals.', energy: (ctx) => (onReveal(ctx) ? 2 : 0), maxPlays: (ctx) => (onReveal(ctx) ? 1 : 3) },
  EmpireStateUniversity: { kind: 'modelled', note: '+2 energy on turn 6.', energy: (ctx) => (ctx.turn === 6 ? 2 : 0) },
  CastleBlackstone: { kind: 'modelled', note: 'Whoever is winning here gets +1 energy.', energy: (ctx) => (ctx.side.winning ? 1 : 0) },
  ReedsLab: { kind: 'modelled', note: '+1 energy with a full side here.', energy: (ctx) => (ctx.side.cards >= 4 ? 1 : 0) },
  StarBrandCrater: { kind: 'modelled', note: '+1 energy with 10+ power here.', energy: (ctx) => (ctx.side.power >= 10 ? 1 : 0) },
  Superflow: { kind: 'modelled', note: '+1 energy with no cards here.', energy: (ctx) => (ctx.side.cards === 0 ? 1 : 0) },
  SakaarGrandPrix: { kind: 'approx', note: 'Winner here after turn 4 gets +1 max energy (assumes current leader).', energy: (ctx) => (ctx.turn >= 5 && ctx.side.winning ? 1 : 0) },
  Feast: { kind: 'approx', note: 'Playing here gives everyone +1 energy next turn; adjust energy if it triggered.' },
  WhiteHotRoom: { kind: 'approx', note: 'First to fill gets +3 max energy; adjust energy if it triggered.' },
  CelestialCircuit: { kind: 'approx', note: 'Hand −1 Cost after turn 4 with 12+ power here; not applied.' },
  FracturedFrontier: { kind: 'approx', note: 'One random card is cheaper this turn; not applied.' },
  StarkIsland: { kind: 'approx', note: 'One random card in each hand gets cheaper; not applied.' },
  TheIceBox: { kind: 'approx', note: 'One random card in each hand costs 1 more; not applied.' },
  WakandanEmbassy: { kind: 'approx', note: 'Cards in hand got +2 when it revealed.', cardPower: (c, ctx) => (ctx.turn >= ctx.reveal ? 2 : 0) },
  TaLo: { kind: 'approx', note: 'One random card in each hand gets +1 each turn; not applied.' },

  // ---- Where cards must go ---------------------------------------------
  AvengersCompound: { kind: 'modelled', note: 'On turn 5, all cards must be played here.', blockOthers: (ctx) => ctx.turn === 5 },
  PetAvengersMansion: { kind: 'modelled', note: 'The turn it reveals, all cards must be played here.', blockOthers: onReveal },
  UtnapishtimsArk: { kind: 'modelled', note: 'After turn 5 the other locations flood.', blockOthers: (ctx) => ctx.turn >= 6 },

  // ---- End of turn -------------------------------------------------------
  MuirIsland: { kind: 'modelled', note: 'End of turn: +1 per card here.', eot: (s) => s.power + s.cards },
  Jotunheim: { kind: 'modelled', note: 'End of turn: −1 per card here.', eot: (s) => s.power - s.cards },
  Boardwalk: { kind: 'modelled', note: 'End of turn: lowest card here gets +1.', eot: (s) => s.power + (s.cards ? 1 : 0) },
  Madripoor: { kind: 'modelled', note: 'End of turn: highest-Cost card here gets +2.', eot: (s) => s.power + (s.cards ? 2 : 0) },
  MoshPit: { kind: 'modelled', note: 'End of turn: front-row cards (first two) get +1.', eot: (s) => s.power + Math.min(2, s.cards) },
  StarkTower: { kind: 'modelled', note: 'End of turn 5: +2 per card here.', eot: (s, o, ctx) => (ctx.turn === 5 ? s.power + 2 * s.cards : s.power) },
  ThunderboltsTower: { kind: 'modelled', note: 'End of turn 5: −2 per card here.', eot: (s, o, ctx) => (ctx.turn === 5 ? s.power - 2 * s.cards : s.power) },
  RocketPad: { kind: 'modelled', note: 'After turn 4: +1 per card on the winning side here.', eot: (s, o, ctx) => (ctx.turn >= 4 && s.power > o.power ? s.power + s.cards : s.power) },
  StarkIndustries: { kind: 'modelled', note: 'End of turn 4: +8 split across all cards here.', eot: (s, o, ctx) => (ctx.turn === 4 && s.cards + o.cards ? s.power + (8 * s.cards) / (s.cards + o.cards) : s.power) },
  Camelot: { kind: 'modelled', note: 'End of turn 5: every card here becomes 5 Power.', eot: (s, o, ctx) => (ctx.turn === 5 ? 5 * s.cards : s.power) },
  GammaLab: { kind: 'modelled', note: 'End of turn 3: every card here becomes a 14-Power Hulk.', eot: (s, o, ctx) => (ctx.turn === 3 ? 14 * s.cards : s.power) },
  Murderworld: { kind: 'modelled', note: 'End of turn 3: all cards here are destroyed.', eot: (s, o, ctx) => (ctx.turn === 3 ? 0 : s.power) },
  Hala: { kind: 'modelled', note: 'End of turn 4: the losing side here is destroyed.', eot: (s, o, ctx) => (ctx.turn === 4 && s.power < o.power ? 0 : s.power) },
  AsgardBesieged: { kind: 'modelled', note: 'End of turn 3: the winner here gets an 18-Power Destroyer.', eot: (s, o, ctx) => (ctx.turn === 3 && s.power > o.power ? s.power + 18 : s.power) },
  OscorpTower: { kind: 'modelled', note: 'End of turn 3: all cards here switch sides.', eot: (s, o, ctx) => (ctx.turn === 3 ? o.power : s.power) },
  Genosha: { kind: 'approx', note: 'End of turn 5: only each side’s highest-Cost card survives (assumes an average card).', eot: (s, o, ctx) => (ctx.turn === 5 && s.cards > 1 ? s.power / s.cards : s.power) },
  WarriorFalls: { kind: 'approx', note: 'End of turn: the weakest card here is destroyed; not applied.' },
  EssexsLab: { kind: 'symmetric', note: 'After turn 4 one card is destroyed and its power split among the others; roughly no net change.' },
  Yggdrasil: { kind: 'approx', note: 'End of turn: +1 to every card at another location; not applied.' },
  SurvivorsCamp: { kind: 'approx', note: 'After turn 4 the winner here draws, others get Horde +2; not applied.' },
  TheDeadlands: { kind: 'approx', note: 'End of turn: Horde +1; not applied.' },
  EternityRange: { kind: 'modelled', note: 'After turn 3 the loser here gets a 0-Power Rock (takes a slot).' },

  // ---- Scoring and other lanes --------------------------------------------
  Cancun: { kind: 'modelled', note: 'Power here doesn’t count toward winning.', scoring: 'ignored' },
  BarWithNoName: { kind: 'modelled', note: 'Whoever has the least power here wins.', scoring: 'lowest' },
  Mojoworld: { kind: 'modelled', note: 'Whoever has more cards here wins it (+100).', scoring: 'cards' },
  BaxterBuilding: { kind: 'modelled', note: 'Whoever wins here gets +4 at the other lanes.', swing: { amount: 4, to: 'others' } },
  CrownCity: { kind: 'modelled', note: 'Whoever wins here gets +4 at the adjacent lanes.', swing: { amount: 4, to: 'adjacent' } },
  TheNexus: { kind: 'modelled', note: 'Power here also counts at the other lanes.', mirror: true },
  ClownCity: { kind: 'approx', note: 'The loser here gets +4 at adjacent lanes; included in your entered totals.' },
  Clubhouse: { kind: 'approx', note: 'Filling it gives +1 at other lanes; included once it happens.' },
  Tva: { kind: 'modelled', note: 'The game ends after turn 4.', endsAfter: 4 },
  Sandcastle: { kind: 'modelled', note: 'The game ends after turn 5.', endsAfter: 5 },
  Limbo: { kind: 'modelled', note: 'There is a turn 7 this game.' },
  DarkDimension: { kind: 'approx', note: 'Cards here stay hidden until the end; enter your best guess of their power.' },

  // ---- Transforms / changes other locations ------------------------------
  MirrorDimension: { kind: 'approx', note: 'Becomes another location on turn 4; pick the new one when it changes.' },
  Westview: { kind: 'approx', note: 'Becomes another location on turn 4; pick the new one when it changes.' },
  WorldForge: { kind: 'approx', note: 'Replaces another location each turn; update the lanes when it does.' },
  LosDiablos: { kind: 'approx', note: 'Ruins a random location after turn 3; update the lanes when it does.' },
  Worldship: { kind: 'approx', note: 'Destroys the other locations; clear them when it reveals.' },
  StarlightCitadel: { kind: 'approx', note: 'Locations swap positions after turn 4; re-enter the lanes.' },
  Bifrost: { kind: 'approx', note: 'After turn 4 all cards move one location right; re-enter the lanes.' },
  StrangeAcademy: { kind: 'approx', note: 'After turn 5 cards here move to random locations; re-enter the lanes.' },
  Ruins: none('No effect.'),

  // ---- Both sides about equally -------------------------------------------
  CampLehigh: sym('Both players get a random 3-Cost card.'),
  CaveOfTheDragon: sym('After turn 4 both sides get a random 5+ Cost card.'),
  CentralPark: sym('Squirrels on both sides of every location.'),
  MonsterIsland: sym('A 10-Power Monster on each side.'),
  SavageLand: sym('Two Raptors on each side.'),
  Shadowland: sym('A −2 Ninja on each side.'),
  Kvch: sym('A random Activate card on each side.'),
  XMansion: sym('After turn 3 both sides get a random card here.'),
  GrandCentral: sym('After turn 5 a card from each hand goes here.'),
  Sakaar: sym('A card from each hand goes here after the reveal turn.'),
  TheHub: sym('Both players get a random card.'),
  Triskelion: sym('Both hands fill with random cards.'),
  Sokovia: sym('Both players discard a card.'),
  Subterranea: sym('Rocks shuffled into both decks.'),
  Mindscape: sym('Hands swap at the start of turn 6; predictions after that are your own old hand.'),
  FogwellsGym: sym('Both players get double Boosters.'),
  KamarTaj: sym('On Reveal abilities here repeat; printed power unaffected.'),
  Valhalla: sym('After turn 4 On Reveals here repeat; printed power unaffected.'),
  OnslaughtsCitadel: sym('Ongoing effects here apply twice; printed power unaffected.'),
  Knowhere: sym('On Reveals here don’t happen; printed power unaffected.'),
  IsleOfSilence: sym('Ongoing effects here are disabled; printed power unaffected.'),
  DeepSpace: sym('Card text is disabled here; printed power is exact.'),
  Klyntar: sym('After turn 4 cards here merge; total power unchanged.'),
  Lemuria: sym('No cards reveal this turn; power still arrives.'),
  Ego: sym('Ego plays both players’ cards automatically.'),
  GreatWeb: sym('End of turn a random card moves to the Web.'),

  // ---- No direct effect on lane power ------------------------------------
  Asgard: none('After turn 4 the winner here draws 2.'),
  AsteroidM: none('3 and 4-Cost cards move here after being played.'),
  AstralPlane: none('Adds a 0-Power copy here.'),
  Attilan: none('After turn 3 hands reshuffle; draw 3.'),
  CelestialBurialGround: none('Discard and replace a card of the same Cost.'),
  ChronosphereSphinx: none('Copies your highest-Cost card into hand.'),
  CloningVats: none('Cards played here are copied to hand.'),
  DailyBugle: none('Copies a card from the opponent’s hand.'),
  DestroyedMansion: none('Adds a Rock here and Vibranium to hand.'),
  Ebonshire: none('Draws the bottom card of the deck.'),
  FiskTower: none('Cards that move here get −4.'),
  FrontierOutpost: none('Draws a 3-Cost card.'),
  GreatPortal: none('Adds a random 10+ Power card to hand.'),
  HellsKitchen: none('Draws a 1-Cost card.'),
  HotelInferno: none('Banishes the top card of the opponent’s deck.'),
  IslandPrison: none('Cards here can’t move.'),
  KunLun: none('Cards that move here get +2.'),
  Krakoa: none('Adds a copy of your next play’s power to your deck.'),
  Lechuguilla: none('Shuffles Rocks into your deck.'),
  Machineworld: none('Gives the opponent a copy of cards played here.'),
  Milano: none('Adds a Guardian to hand.'),
  MotherMold: none('Adds a Sentinel to hand.'),
  MountVesuvius: none('No retreating after turn 5.'),
  NewYork: none('On turn 6 cards can move here.'),
  NoorDimension: none('Adds a Djinn to hand.'),
  NovaRoma: none('Both players draw a card.'),
  Olympia: none('Both players draw 2.'),
  OrchisForge: none('Adds a Sentinel to hand.'),
  OttosLab: none('Pulls a card from the enemy hand to their side.'),
  PizzaPlace: none('Adds Pizza Slices to hand.'),
  PyramidOfRamaTut: none('Adds a Rock to hand.'),
  QuantumTunnel: none('Swaps a played card with one from your deck.'),
  SanctumInfinitum: none('Discard, then fill this to get it back with +5.'),
  SinisterLondon: none('Copies played cards to another location.'),
  TacoTruck: none('Adds a Chimichanga to hand.'),
  TheAbbey: none('First to put exactly 2 cards here draws.'),
  ThePeak: none('Steals the leftmost card from the opponent’s hand.'),
  Raft: none('First to fill gets a free 6-Cost card.'),
  SacredTimeline: none('First to fill copies their opening hand.'),
  TimeTheater: none('Copies your last draw.'),
  ValleyOfTheHand: none('After turn 5 destroyed cards revive here.'),
  VibraniumMines: none('Shuffles Vibranium into your deck.'),
  Wakanda: none('Cards here can’t be destroyed.'),
  WeaponXFacility: none('Discard to draw.'),
  Weirdworld: none('Draws 2 from the opponent’s deck.'),
  WhitePalace: none('Copies a card from the opponent’s hand.'),
  ZennLa: none('Adds a 3-Cost card from deck here.'),
};

export const KIND_LABEL = { modelled: 'Modelled', approx: 'Approximate', symmetric: 'Hits both sides', none: 'No power effect' };

export function locationEffect(id) {
  return (id && LOCATION_EFFECTS[id]) || null;
}

const scoreMargin = (scoring, me, opp) => {
  if (scoring === 'ignored') return 0;
  if (scoring === 'lowest') return opp.power - me.power;
  if (scoring === 'cards') return me.cards !== opp.cards ? 100 * (me.cards - opp.cards) : me.power - opp.power;
  return me.power - opp.power;
};

// Context for a location hook, seen from one side.
function laneCtx(i, turn, lane, who, avgPower) {
  const me = { power: lane.mine, cards: lane.myCards };
  const opp = { power: lane.theirs, cards: lane.oppCards };
  const side = who === 'opp' ? opp : me;
  const other = who === 'opp' ? me : opp;
  return { turn, reveal: i + 1, lane: i, avgPower, side: { ...side, winning: side.power > other.power }, other };
}

// Global modifiers from every revealed location: costs, energy, play limits.
export function boardModifiers(lanes, turn, avgPower) {
  const fxs = lanes.map((l, i) => [locationEffect(l.loc), i]).filter(([fx, i]) => fx && turn >= i + 1);
  const ctxFor = (i, who) => laneCtx(i, turn, lanes[i], who, avgPower);

  const energyFor = (who) => fxs.reduce((s, [fx, i]) => s + (fx.energy ? fx.energy(ctxFor(i, who)) : 0), 0);
  const forced = fxs.filter(([fx, i]) => fx.blockOthers?.(ctxFor(i, 'opp'))).map(([, i]) => i);
  const ends = fxs.map(([fx]) => fx.endsAfter).filter(Boolean);
  return {
    costOf: (c) => Math.max(0, c.cost + fxs.reduce((s, [fx, i]) => s + (fx.costMod ? fx.costMod(c, ctxFor(i, 'opp')) : 0), 0)),
    powerOf: (c) => c.power + fxs.reduce((s, [fx, i]) => s + (fx.cardPower ? fx.cardPower(c, ctxFor(i, 'opp')) : 0), 0),
    oppEnergy: energyFor('opp'),
    myEnergy: energyFor('me'),
    maxPlays: Math.min(3, ...fxs.map(([fx, i]) => (fx.maxPlays ? fx.maxPlays(ctxFor(i, 'opp')) : 3))),
    forced,
    lastTurn: ends.length ? Math.min(...ends) : 6,
  };
}

// Lane rules for opponentThreat() / my answers.
export function laneRules(lanes, i, turn, who, avgPower, mods) {
  const lane = lanes[i];
  const fx = turn >= i + 1 ? locationEffect(lane.loc) : null;
  const ctx = laneCtx(i, turn, lane, who, avgPower);
  const cardsHere = who === 'opp' ? lane.oppCards : lane.myCards;
  const forcedElsewhere = mods.forced.length && !mods.forced.includes(i);
  let capacity = Math.max(0, 4 - cardsHere);
  if (fx?.capacity) capacity = Math.min(capacity, fx.capacity(ctx));
  if (forcedElsewhere) capacity = 0;
  return {
    capacity: Math.min(capacity, mods.maxPlays),
    allowed: (c) => !fx?.blocked?.(c, ctx),
    bonus: (c, n) => (fx?.power ? fx.power(c, ctx, n) : 0),
  };
}

// Projects every lane: the opponent's best play into it, end-of-turn effects,
// scoring rules and swings between lanes. `threatFor(i)` returns the
// opponent's threat ({ power, cards }) for lane i.
export function evaluateBoard(lanes, turn, threatFor, avgPower) {
  const fxs = lanes.map((l, i) => (turn >= i + 1 ? locationEffect(l.loc) : null));
  const threats = lanes.map((_, i) => threatFor(i));

  // The Nexus: whatever the opponent adds there also counts everywhere else.
  const mirrorAdd = lanes.map((_, i) => fxs.reduce((s, fx, j) => s + (fx?.mirror && j !== i ? threats[j].power : 0), 0));

  const project = (i, addOpp, addOppCards) => {
    const fx = fxs[i];
    const ctx = { turn, reveal: i + 1, lane: i, avgPower };
    const me = { power: lanes[i].mine, cards: lanes[i].myCards };
    const opp = { power: lanes[i].theirs + addOpp, cards: lanes[i].oppCards + addOppCards };
    if (!fx?.eot) return { me, opp };
    return { me: { ...me, power: fx.eot(me, opp, ctx) }, opp: { ...opp, power: fx.eot(opp, me, ctx) } };
  };

  const base = lanes.map((_, i) => {
    const now = project(i, 0, 0);
    const after = project(i, threats[i].power + mirrorAdd[i], threats[i].cards.length);
    const scoring = fxs[i]?.scoring;
    return { now, after, scoring, nowMargin: scoreMargin(scoring, now.me, now.opp), afterMargin: scoreMargin(scoring, after.me, after.opp) };
  });

  // Swings: if I'm winning a Baxter Building / Crown City lane now but the
  // opponent could flip it, my +N leaves the target lanes and they gain +N.
  // Treated as a separate scenario (their energy goes into the source lane),
  // so it isn't stacked on top of their direct play into the target lane.
  const swingIn = lanes.map(() => null);
  fxs.forEach((fx, j) => {
    if (!fx?.swing) return;
    const b = base[j];
    if (!(b.nowMargin > 0 && b.afterMargin <= 0)) return;
    lanes.forEach((_, i) => {
      if (i === j) return;
      if (fx.swing.to === 'adjacent' && Math.abs(i - j) !== 1) return;
      const prev = swingIn[i];
      swingIn[i] = { amount: (prev?.amount || 0) + 2 * fx.swing.amount, from: [...(prev?.from || []), j] };
    });
  });

  return lanes.map((lane, i) => {
    const b = base[i];
    const threat = threats[i];
    const swing = swingIn[i];
    const nowEot = fxs[i]?.eot && (b.now.me.power !== lane.mine || b.now.opp.power !== lane.theirs);
    const afterMargin = b.afterMargin;
    const swingMargin = swing ? b.nowMargin - swing.amount : Infinity;
    const threatPower = threat.power + mirrorAdd[i];
    let status, headline, sub;
    if (b.scoring === 'ignored') {
      status = 'closed'; headline = 'Doesn’t count'; sub = 'Cancun: power here is ignored';
    } else if (b.scoring === 'cards') {
      const diff = lane.myCards - lane.oppCards;
      const oppMore = threat.cards.length;
      if (diff <= 0) { status = 'losing'; headline = `Need ${1 - diff} more card${1 - diff > 1 ? 's' : ''}`; sub = 'More cards wins here'; }
      else if (diff > oppMore) { status = 'safe'; headline = `Ahead by ${diff} card${diff > 1 ? 's' : ''}`; sub = `they can add ${oppMore}`; }
      else { status = 'at-risk'; headline = 'At risk'; sub = `they can add ${oppMore} card${oppMore > 1 ? 's' : ''}`; }
    } else if (b.scoring === 'lowest') {
      if (b.nowMargin <= 0) { status = 'losing'; headline = `Too high by ${1 - b.nowMargin}`; sub = 'Lowest power wins here'; }
      else { status = 'safe'; headline = `Winning by ${b.nowMargin}`; sub = 'Lowest power wins here'; }
    } else if (b.nowMargin <= 0) {
      status = 'losing'; headline = `Need +${1 - b.nowMargin}`;
      sub = threatPower > 0 ? `+${Math.max(1, 1 - afterMargin)} to hold vs. their best` : 'to win';
    } else if (afterMargin <= 0) {
      status = 'at-risk'; headline = 'At risk'; sub = `+${1 - afterMargin} to hold`;
    } else if (swingMargin <= 0) {
      status = 'at-risk'; headline = 'At risk'; sub = `if they take Location ${swing.from[0] + 1}`;
    } else {
      status = 'safe'; headline = `Safe by ${afterMargin}`; sub = threatPower > 0 ? `even vs. +${threatPower}` : 'no likely threat';
    }
    const notes = [];
    if (nowEot) notes.push(`End of turn: you ${Math.round(b.now.me.power)}, them ${Math.round(b.now.opp.power)}`);
    if (mirrorAdd[i]) notes.push(`+${mirrorAdd[i]} from The Nexus`);
    if (swing) notes.push(`If they take Location ${swing.from.map((j) => j + 1).join(' & ')}: −${swing.amount / 2} you, +${swing.amount / 2} them here`);
    return { status, headline, sub, threat, threatPower, notes, scoring: b.scoring, need: Math.max(0, 1 - b.nowMargin), holdNeed: Math.max(0, 1 - Math.min(afterMargin, swingMargin)) };
  });
}
