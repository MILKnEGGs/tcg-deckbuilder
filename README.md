# Milk's Deck Builders

Offline deck builders for trading card games, with each format's deck rules and TCGplayer prices.
Live at https://milkneggs.github.io/tcg-deckbuilder/.

| App | Game | Formats |
|---|---|---|
| [Milk's SWU Deck Builder](apps/swu) | Star Wars: Unlimited | Order 66, Twin Suns, Premier, Eternal |
| [Milk's Digimon Deck Builder](apps/digimon) | Digimon Card Game (English cards) | Standard |

Every deck has a Build view (search and list side by side) and a Deck view (the deck as card images, with stats).
You can also keep a Considering list of maybe-adds and maybe-cuts, goldfish sample hands, and buy missing cards through a pre-filled TCGplayer Mass Entry link.

**Keeping SWU legal:** Premier rotation and the suspended lists live at the top of `apps/swu/src/game.ts` (`PREMIER_SETS`, `SUSPENDED`).
Update them when Fantasy Flight announces changes. That's at least once a set, and the next rotation is expected in Feb 2027.

**Keeping Digimon legal:** the banned, restricted and banned-pair lists are at the top of `apps/digimon/src/game.ts`, copied from the official list at world.digimoncard.com/rule/restriction_card/.
Card data comes from [digimoncard.io](https://digimoncard.io). A card counts as released in English once TCGplayer lists it, and it can be added from its release date.

## How it's put together

- `packages/core`: everything the games share. That's the deck model, validation helpers, storage (IndexedDB, per device), pricing, import/export and the whole UI. A game plugs in by providing a `GameDef` (see `src/types.ts`).
- `apps/<game>`: one installable PWA per game. Each has its own `game.ts` (card shape, formats, rules, filters, decklist formats) and `scripts/data.mjs`, which downloads the cards and prices into `public/data/cards.json`.

Card data comes from community databases (SWU: [swu-db.com](https://www.swu-db.com)). Prices come from [TCGCSV](https://tcgcsv.com), a daily copy of TCGplayer's prices. Alt-art printings are ignored, so a card's price is its cheapest standard printing.

## Working on it

```bash
npm install
npm run data   # download card data + prices (needed once before dev)
npm run dev    # SWU app at http://localhost:5173
npm test
npm run build  # all apps into dist/
```

In Visual Studio, open `tcg-deckbuilder.sln`. F5 runs the SWU app.

## Deploying

Every push to `main` deploys to GitHub Pages. A daily scheduled run refreshes the card data and prices.
GitHub pauses scheduled runs after 60 days without a commit. It emails first, and one click on the Actions tab turns them back on.

## Adding a game

1. Copy `apps/swu` to `apps/<game>`, and change the names in `package.json`, `index.html` and `vite.config.ts` (`outDir: '../../dist/<game>'`).
2. Rewrite `scripts/data.mjs` for the game's card source (keep the output shape: `{ updated, cards }`, each card with `id`, `name`, `price`).
3. Rewrite `src/game.ts`: formats, zones, `validate`, filters, decklist import/export.
4. Add a link to it in `site/index.html`.
