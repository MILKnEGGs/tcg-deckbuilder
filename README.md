# Milk's Deck Builders

Offline deck builders for trading card games, with each format's deck rules and TCGplayer prices.
Live at https://milkneggs.github.io/tcg-deckbuilder/.

| App | Game | Formats |
|---|---|---|
| [Milk's SWU Deck Builder](apps/swu) | Star Wars: Unlimited | Order 66, Twin Suns, Premier, Eternal |
| [Milk's Digimon Deck Builder](apps/digimon) | Digimon Card Game (English cards) | Standard |
| [Milk's One Piece Deck Builder](apps/onepiece) | One Piece Card Game (English cards) | Standard, Extra Regulation |
| [Milk's Union Arena Deck Builder](apps/unionarena) | Union Arena (English cards) | Official |
| [Milk's Fusion World Deck Builder](apps/fusionworld) | Dragon Ball Super Card Game Fusion World (English cards) | Standard |
| [Milk's UniVersus Deck Builder](apps/universus) | UniVersus (and Universal Fighting System) | Standard, Retro |
| [Milk's Lorcana Deck Builder](apps/lorcana) | Disney Lorcana | Core, Infinity |
| [Milk's Pokémon Deck Builder](apps/pokemon) | Pokémon TCG | Standard, Expanded |
| [Milk's Flesh and Blood Deck Builder](apps/fab) | Flesh and Blood | Classic Constructed, Blitz, Silver Age, Living Legend |
| [Milk's Destiny Deck Builder](apps/destiny) | Star Wars: Destiny (official + A Renewed Hope community sets) | ARH Standard, Galactic Infinite, FFG Standard, FFG Trilogy, FFG Infinite |

Every deck has a Build view (search and list side by side) and a Deck view (the deck as card images, with stats).
You can also keep a Considering list of maybe-adds and maybe-cuts, goldfish sample hands, and buy missing cards through a pre-filled TCGplayer Mass Entry link.

**Keeping SWU legal:** Premier rotation and the suspended lists live at the top of `apps/swu/src/game.ts` (`PREMIER_SETS`, `SUSPENDED`).
Update them when Fantasy Flight announces changes. That's at least once a set, and the next rotation is expected in Feb 2027.

**Keeping Digimon legal:** the banned, restricted and banned-pair lists are at the top of `apps/digimon/src/game.ts`, copied from the official list at world.digimoncard.com/rule/restriction_card/.
Card data comes from [digimoncard.io](https://digimoncard.io). A card counts as released in English once TCGplayer lists it, and it can be added from its release date.

**Keeping One Piece legal:** the banned list and banned pairs are at the top of `apps/onepiece/src/game.ts`, from en.onepiece-cardgame.com/news/restriction.html.
Standard rotation is worked out in `apps/onepiece/scripts/data.mjs`: Block 1 is OP01–OP04, ST01–ST10 and the promos of that time, unless a card was reprinted later.
Card data and pictures both come from TCGplayer (via TCGCSV).

**Keeping Lorcana legal:** nothing to maintain by hand. Each card's Core and Infinity legality (rotation and bans) comes from [Lorcast](https://lorcast.com/) daily.

**Keeping Pokémon legal:** Standard legality (rotation by regulation mark) comes from [TCGdex](https://tcgdex.dev/) daily.
The Expanded banned list is at the top of `apps/pokemon/src/game.ts` (`EXPANDED_BANS`), from pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list. Update it when Play! Pokémon announces bans.

**Keeping Flesh and Blood legal:** nothing to maintain by hand. Legality, bans, suspensions and the Living Legend restricted list for every format come from the open [the-fab-cube card database](https://github.com/the-fab-cube/flesh-and-blood-cards) daily.

**Keeping Destiny legal:** nothing to maintain by hand. Cards, legal sets, bans, the restricted list and pairs, and per-format point changes all come from the [A Renewed Hope](https://swdrenewedhope.com/) database each day.
Community sets are free print-and-play; TCGplayer prices exist only for official Fantasy Flight cards.

**Keeping UniVersus legal:** the ban lists are at the top of `apps/universus/src/game.ts`, from uvsgames.com/news/formats-and-ban-lists/. UVS Games updates them on the first Tuesday of each month.
Standard rotation (sets from the last three years) is worked out daily by `apps/universus/scripts/data.mjs`.
Attuned symbols come from [UVS Ultra](https://uvsultra.online/), downloaded at most weekly (`scripts/uvsultra.mjs`). `scripts/uvsultra.json` is the committed fallback copy.

**Keeping Union Arena legal:** the restricted list is at the top of `apps/unionarena/src/game.ts`, from unionarena-tcg.com/na/rules/limited.php.
Card data and pictures come from TCGplayer (via TCGCSV).

**Keeping Fusion World legal:** the banned and restricted lists are at the top of `apps/fusionworld/src/game.ts`, from the "Banned/Restricted Cards" link on dbs-cardgame.com/fw/en/news/01_31.html (the official rules page).
Card data and pictures come from TCGplayer (via TCGCSV); leaders' awakened sides are Bandai's own card images.

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
