# Snap Scout

Predicts which cards your Marvel Snap opponent is holding, from the cards they've played.

Open `index.html` through any static server (e.g. `python3 -m http.server`). Everything runs in the browser.

## How a game is tracked

Tap a card, then tap the location it went to (your cards from the deck strip, theirs from the prediction list). Tap a card on the board to move it, correct its power, or mark it destroyed. The game is stored as an ordered log of plays, moves, destroys and edits; `engine.js` replays it with card abilities (`abilities.js`) and location effects to work out every lane total. Abilities trigger automatically: Iron Fist moves your next card left, Human Torch doubles on every move, Ghost-Spider pulls your last card, Wong repeats On Reveals, Arnim Zola copies, and so on. Every card with an ability has a rule (`abilities.js` for the meta, `abilities-more.js` for the rest of the pool): modelled exactly, approximated (random targets, "adjust by hand" for Activate and Objective effects), or marked as not affecting the board (hand, deck, cost and energy effects). Tests fail if a data refresh brings a card without a rule. For random or copied text (Red Onslaught, Kang, Hulkling, Morph…), tap the card and **Set its ability**. For cards missing from the data (Scarlet Witch's skills), **+ Add card → Custom…** saves a card with a name, cost, power and a basic effect for reuse. − / + on a lane total corrects anything else.

## Hands, decks and predicted cards

In the win-chance playouts both players have real (sampled) hands and decks inside the engine: cards are drawn each turn, played from hand with any changes made to them there, and hand / deck / discard / cost / energy abilities work for real (`abilities-zones.js`): Surge, America Chavez, Okoye, Psylocke, Electro, Wiccan, Magik's Limbo turn 7, the discard package (Blade, Lady Sif, Modok, Apocalypse, Swarm, Hela…), cost cheats (Death, Sasquatch, Mockingbird…), card-adders (Agent Coulson, Nick Fury…), Thanos's Infinity Stones and Thanos (Fractured Frontier)'s Quickdraw shots. On the live board, effects that put a card from hand or deck into play (Anti-Polar Magneto, Jubilee, Dragon Lord, Doctor Octopus, Baron Zemo…) place the most likely card from the predicted deck, shown dashed as "likely"; tap it and choose "It was actually…" to correct it.

## Win chance and snapping

`sim.js` plays the rest of the game out ~160 times from the current board: the opponent's unseen cards are sampled from the prediction model, your remaining deck is shuffled (or your marked hand used), and both sides commit their plays blind each turn, choosing among their most energy-efficient options by what they actually do on the board. The share of playouts you win gives the call: Snap (70%+), Lean snap (55%+), Play it out (40%+), Don't snap / retreat if they snap (25%+), Retreat (below). Mirror matches come out at ~50%. The playouts use simple play logic and only the modelled abilities, so treat it as a guide.

## How it predicts

- **Card co-occurrence** (`model.js`): from about 10k tracked decklists weighted by games played, each card's probability of being in the deck is its baseline frequency shifted by the log-lift of every card seen so far. Smoothing stops rare cards overreacting, and the probabilities are rescaled to sum to the number of unseen cards.
- **Soft deck match**: decks containing all but up to 3 of the seen cards. This is blended in only when a strong partial match exists (decks missing at most one seen card).
- **In hand** ≈ P(in deck) × hand size / (12 − cards played).
- **Next play** weights in-hand odds by cost vs energy this turn.
- **Lanes**: the power you need to win each lane, and the opponent's likely max added power from their top predicted affordable cards (printed power; card abilities are flagged "not modelled").
- **Locations** (`locations.js`): every released location has a rule: exact (power per card, blocks, cost/energy changes, end-of-turn effects, scoring changes, Baxter Building style swings), approximate (random outcomes use averages), symmetric (no net change), or no power effect. `tests/` fails if a data refresh brings a location without a rule.
- **Created and random cards**: every lane has "+ Add card" (or "What came out?" on locations like Black Vortex, Tarnax, Camp Lehigh, Cave of the Dragon). Pick the card, edit its power (e.g. Blob at 15), and choose their side, your side or your hand. Board cards update that lane's total and card count; hand cards feed your best-play suggestions. "Next card" locations stop being estimated once marked used.
- **My decks** (`decks.js`): import a deck by pasting the code from Marvel Snap's Copy button (short or long format) or card names; export back to a code. In game, tap your cards to mark them in hand or played. Scout suggests the cheapest play that wins or holds each lane and alerts when your tech cards (Shang-Chi, Enchantress, Armor, Cosmo, Killmonger…) have targets on board or likely in the opponent's deck. Decks are stored on the device only.

## Data

`node scripts/fetch-data.mjs` refreshes `data/`: cards from Marvel Snap Zone, decklists and game counts from Untapped.gg ("Latest Patch" window). Both endpoints are undocumented, so refresh occasionally rather than calling them from the app.

## Tests

`node --test tests/*.test.mjs`

## Backtest

`node scripts/backtest.mjs [--samples 3000] [--seed 1] [--tune]` holds out 20% of decklists, reveals N = 2..6 random cards from game-weighted test decks, and reports the top-5 and top-10 hit rates for the hidden cards. `--tune` grid-searches the model parameters on a validation slice of the training decks.
