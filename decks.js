// Your decks: deck code import/export, counter alerts and per-lane answers.

// ---- Deck codes ------------------------------------------------------------
// Marvel Snap uses two codes, both base64:
//   long:  {"Name":"…","Cards":[{"CardDefId":"Blade"},…]}
//   short: "Bld5,Scrn5,…" where each short name is the CardDefId with vowels
//          (and y) removed after the first letter, plus its length in hex.
export const shortName = (id) => id[0] + id.slice(1).replace(/[aeiouy]/g, '') + id.length.toString(16).toUpperCase();

const b64decode = (s) => {
  try { return new TextDecoder().decode(Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))); } catch { return ''; }
};
const b64encode = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Accepts a pasted deck code (the whole "Copy deck" text works), or a list of
// card names one per line / comma-separated. Returns { name, cards, unknown }.
export function parseDeck(text, cards) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const byShort = new Map(cards.map((c) => [shortName(c.id), c.id]));
  const byName = new Map();
  for (const c of cards) {
    byName.set(norm(c.name), c.id);
    byName.set(norm(c.id), c.id);
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const code = lines.filter((l) => !l.startsWith('#') && !l.includes(' ')).join('');
  if (code) {
    const raw = b64decode(code);
    if (raw.includes('{')) {
      try {
        const j = JSON.parse(raw);
        const ids = (j.Cards || []).map((c) => c.CardDefId);
        return finish(j.Name || '', ids.filter((id) => byId.has(id)), ids.filter((id) => !byId.has(id)));
      } catch {}
    } else if (raw.includes(',')) {
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const ids = parts.map((p) => byShort.get(p));
      // Single-word card names can look like base64; only trust a real code.
      if (ids.filter(Boolean).length * 2 >= parts.length) return finish('', ids.filter(Boolean), parts.filter((p, i) => !ids[i]));
    }
  }
  // Names: "# (3) Wolverine" lines from the game's copy text, or plain names.
  const named = lines.flatMap((l) => {
    const m = l.match(/^#\s*\(\d+\)\s*(.+)$/);
    if (m) return [m[1]];
    if (l.startsWith('#')) return [];
    return l.split(',');
  }).map((s) => s.trim()).filter(Boolean);
  const ids = named.map((n) => byName.get(norm(n)));
  return finish('', ids.filter(Boolean), named.filter((n, i) => !ids[i]));

  function finish(name, found, unknown) {
    return { name, cards: [...new Set(found)].slice(0, 12), unknown };
  }
}

// Short code the game accepts when pasted into the deck editor.
export function deckCode(ids) {
  return b64encode(ids.map(shortName).join(','));
}

// ---- Counters --------------------------------------------------------------
// Tech cards and what they answer. `hits(card)` is true for an opponent card
// the counter is good against.
const txt = (c) => c.ability || '';
export const COUNTERS = {
  Enchantress: { why: 'removes Ongoing abilities', hits: (c) => c.ongoing },
  Rogue: { why: 'steals an Ongoing ability', hits: (c) => c.ongoing },
  Echo: { why: 'strips their next Ongoing card', hits: (c) => c.ongoing },
  Cosmo: { why: 'blocks On Reveals at a location', hits: (c) => /On Reveal/i.test(txt(c)) },
  Armor: { why: 'stops destroy at a location', hits: (c) => /destroy/i.test(txt(c)) && /enemy|ALL|each player/i.test(txt(c)) },
  ShangChi: { why: 'destroys a 10+ Power card', hits: (c) => c.power >= 10 },
  Killmonger: { why: 'destroys all 1-Costs', hits: (c) => c.cost === 1 },
  LukeCage: { why: 'blocks Power reduction', hits: (c) => /-\d+ Power|afflict/i.test(txt(c)) },
  MobiusMMobius: { why: 'stops their cost cuts', hits: (c) => /-\d+ Cost|cost (\d+ )?less/i.test(txt(c)) },
  Leech: { why: 'strips text from 6-Costs in hand', hits: (c) => c.cost === 6 && c.special },
  ShadowKing: { why: 'resets buffed Power', hits: (c) => /\+\d+ Power/.test(txt(c)) && !c.ongoing },
  RedGuardian: { why: 'strips text and −2 from a small card', hits: (c) => c.cost <= 2 && c.special },
};

// For each counter in my remaining deck: which predicted (or already played)
// opponent cards it answers, and the chance they have at least one.
export function counterAlerts(myCards, oppPlayed, oppRows, cardsById) {
  const alerts = [];
  for (const id of myCards) {
    const ct = COUNTERS[id];
    if (!ct) continue;
    const onBoard = oppPlayed.map((x) => cardsById.get(x)).filter((c) => c && ct.hits(c));
    const likely = oppRows.filter((r) => r.pDeck >= 0.1 && ct.hits(r)).sort((a, b) => b.pDeck - a.pDeck);
    const pAny = onBoard.length ? 1 : 1 - likely.reduce((p, r) => p * (1 - r.pDeck), 1);
    if (!onBoard.length && pAny < 0.25) continue;
    alerts.push({ id, why: ct.why, onBoard, likely: likely.slice(0, 3), pAny });
  }
  return alerts.sort((a, b) => b.pAny - a.pAny);
}

// ---- Lane answers ----------------------------------------------------------
// Cheapest combination of my cards (up to 3, within energy, allowed here) that
// reaches `target` power; if none does, the strongest affordable one.
export function bestAnswer(myRows, energy, lane, target) {
  const pool = myRows.filter((c) => c.cost <= energy && lane.allowed(c));
  const maxCards = Math.min(3, lane.capacity);
  let reach = null, strongest = null;
  const walk = (start, cost, picked) => {
    if (picked.length) {
      const power = picked.reduce((s, c) => s + c.power + lane.bonus(c, picked.length), 0);
      const pick = { power, cost, cards: [...picked] };
      if (power >= target && (!reach || cost < reach.cost || (cost === reach.cost && power > reach.power))) reach = pick;
      if (!strongest || power > strongest.power) strongest = pick;
    }
    if (picked.length === maxCards) return;
    for (let i = start; i < pool.length; i++) {
      if (cost + pool[i].cost > energy) continue;
      picked.push(pool[i]);
      walk(i + 1, cost + pool[i].cost, picked);
      picked.pop();
    }
  };
  walk(0, 0, []);
  return reach ? { ...reach, enough: true } : strongest ? { ...strongest, enough: false } : null;
}
