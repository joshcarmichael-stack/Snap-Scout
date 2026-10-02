# Snap Scout

Predicts which cards your Marvel Snap opponent is holding, from the cards they've played.

Open `index.html` through any static server (e.g. `python3 -m http.server`). Everything runs in the browser.

## How it predicts

- **Card co-occurrence** (`model.js`): from about 10k tracked decklists weighted by games played, each card's probability of being in the deck is its baseline frequency shifted by the log-lift of every card seen so far. Smoothing stops rare cards overreacting, and the probabilities are rescaled to sum to the number of unseen cards.
- **Soft deck match**: decks containing all but up to 3 of the seen cards. This is blended in only when a strong partial match exists (decks missing at most one seen card).
- **In hand** ≈ P(in deck) × hand size / (12 − cards played).
- **Next play** weights in-hand odds by cost vs energy this turn.
- **Lanes**: the power you need to win each lane, and the opponent's likely max added power from their top predicted affordable cards. Printed power only; abilities are flagged "not modelled".

## Data

`node scripts/fetch-data.mjs` refreshes `data/`: cards from Marvel Snap Zone, decklists and game counts from Untapped.gg ("Latest Patch" window). Both endpoints are undocumented, so refresh occasionally rather than calling them from the app.

## Backtest

`node scripts/backtest.mjs [--samples 3000] [--seed 1] [--tune]` holds out 20% of decklists, reveals N = 2..6 random cards from game-weighted test decks, and reports the top-5 and top-10 hit rates for the hidden cards. `--tune` grid-searches the model parameters on a validation slice of the training decks.
