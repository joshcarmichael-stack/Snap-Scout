// Refreshes data/cards.json and data/decks.json.
//   node scripts/fetch-data.mjs
// Cards come from Marvel Snap Zone, decklists + game counts from Untapped.gg.
// Both are undocumented endpoints: run this occasionally, not from the app.
import { writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (snap-scout data refresh)';
const CARDS_URL = 'https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true';
const DECKS_URL = 'https://api.snap.untapped.gg/api/v1/analytics/query/decks_stats_by_pool_v4/free?TimestampRangeFilter=CURRENT_META_PERIOD';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Origin: 'https://snap.untapped.gg' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/&#0?39;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const [mszRaw, utRaw] = await Promise.all([getJson(CARDS_URL), getJson(DECKS_URL)]);

const defIds = utRaw.metadata.d_map;
const inDecks = new Set(defIds);

// Cards: every character, so the tap-to-add search can find cards outside the
// tracked meta. MSZ marks generated cards (Winter Soldier, Basic Arrow...) and
// upcoming cards as unreleased; they're kept, flagged `generated`, because
// opponents can still put them into play.
const cards = [];
for (const c of mszRaw.success.cards) {
  if (c.type !== 'Character') continue;
  const tags = (c.tags || []).map((t) => t.tag);
  const ability = stripHtml(c.ability);
  cards.push({
    id: c.carddefid,
    name: stripHtml(c.name),
    cost: Number(c.cost) || 0,
    power: Number(c.power) || 0,
    ability,
    ongoing: tags.includes('Ongoing') || /^Ongoing:/i.test(ability),
    special: ability.length > 0,
    ...(c.status !== 'released' && !inDecks.has(c.carddefid) ? { generated: true } : {}),
  });
}
cards.sort((a, b) => a.name.localeCompare(b.name));
const known = new Set(cards.map((c) => c.id));
const missing = defIds.filter((id) => !known.has(id));
if (missing.length) console.warn('Deck cards missing from MSZ card list:', missing.join(', '));

// Decks: card indices into `defIds`, weight = total recorded games across all
// collection pools and ranks.
const decks = [];
for (const row of utRaw.data) {
  let games = 0;
  for (const [key, pool] of Object.entries(row)) {
    if (key === 'd') continue;
    for (const v of Object.values(pool)) if (Array.isArray(v)) games += Number(v[0]) || 0;
  }
  if (games > 0 && row.d.length === 12) decks.push([games, ...row.d]);
}
decks.sort((a, b) => b[0] - a[0]);

const fetched = new Date().toISOString().slice(0, 10);
writeFileSync(new URL('../data/cards.json', import.meta.url), JSON.stringify({ fetched, source: 'marvelsnapzone.com', cards }));
// One deck per line keeps git diffs readable.
writeFileSync(
  new URL('../data/decks.json', import.meta.url),
  `{"fetched":"${fetched}","source":"snap.untapped.gg CURRENT_META_PERIOD","format":"[games, ...12 indices into ids]",\n"ids":${JSON.stringify(defIds)},\n"decks":[\n${decks.map((d) => JSON.stringify(d)).join(',\n')}\n]}\n`,
);
console.log(`${cards.length} cards, ${decks.length} decks, ${decks.reduce((s, d) => s + d[0], 0)} games`);
