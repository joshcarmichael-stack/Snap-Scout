// Location effects Snap Scout can model when projecting what the opponent can
// add to a lane. The lane totals you type in already include location effects
// on cards on the board, so only effects on *future plays* matter here.
// Locations not listed (or effects not covered) show as "not modelled".
//
// Each entry may have:
//   power(card, ctx)  extra power a card gets when played here
//   blocked(card, ctx) true if the card can't be played here
//   maxPlays          most cards one player can play here this turn
//   costMod(card, ctx) global cost change (applies at every lane)
//   partial           true if part of the text is still not modelled
// ctx = { turn, cardsHere (opponent's cards already here), playing (cards in this play) }

const allCards = () => true;

export const LOCATION_EFFECTS = {
  Nidavellir: { power: () => 5 },
  Xandar: { power: () => 1 },
  SewerSystem: { power: () => -1 },
  Necrosha: { power: () => -2 },
  NegativeZone: { power: () => -3 },
  Proscenium: { power: () => 2 },
  LakeHellas: { power: (c) => (c.cost === 1 ? 2 : 0) },
  WashingtonDC: { power: (c) => (c.special ? 0 : 3) },
  Atlantis: { power: (c, ctx) => (ctx.cardsHere === 0 && ctx.playing === 1 ? 5 : 0) },

  Flooded: { blocked: allCards },
  SanctumSanctorum: { blocked: allCards },
  CrimsonCosmos: { blocked: (c) => c.cost <= 3 },
  HellfireClub: { blocked: (c) => c.cost === 1 },
  TheBigHouse: { blocked: (c) => c.cost >= 4 },
  PitOfExile: { blocked: (c) => c.power >= 10 },
  Kyln: { blocked: (c, ctx) => ctx.turn > 4 },
  Vault: { blocked: (c, ctx) => ctx.turn === 6 },

  Elysium: { costMod: () => -1 },
  Titan: { costMod: (c) => (c.cost === 6 ? -1 : 0) },
  Utopia: { costMod: (c) => (c.cost === 3 || c.cost === 4 ? -1 : 0) },
  DreamDimension: { costMod: (c, ctx) => (ctx.turn === 5 ? 1 : 0) },
};

export function locationEffect(id) {
  return (id && LOCATION_EFFECTS[id]) || null;
}

// Effective cost of a card given every revealed location (cost changes are global).
export function effectiveCost(card, locationIds, turn) {
  let cost = card.cost;
  for (const id of locationIds) {
    const fx = locationEffect(id);
    if (fx?.costMod) cost += fx.costMod(card, { turn });
  }
  return Math.max(0, cost);
}

// Lane rules for opponentThreat(): what can be played here, how many, and
// what bonus each card gets.
export function laneRules(locationId, { turn, oppCardsHere }) {
  const fx = locationEffect(locationId);
  const ctx = { turn, cardsHere: oppCardsHere };
  return {
    capacity: Math.max(0, Math.min(fx?.maxPlays ?? 4, 4 - oppCardsHere)),
    allowed: (c) => !fx?.blocked?.(c, ctx),
    bonus: (c, playing) => (fx?.power ? fx.power(c, { ...ctx, playing }) : 0),
  };
}
