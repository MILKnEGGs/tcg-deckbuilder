// Builds public/data/cards.json for the Lorcana app. Cards, images and each card's legality in Core and
// Infinity (bans included) come from Lorcast (api.lorcast.com); prices from TCGCSV (TCGplayer) by the
// TCGplayer id Lorcast gives each printing. Run with "npm run data"; the deploy workflow runs it daily.
//
// A card is its name plus version ("Stitch - Rock Star"): the copy limit counts those, so reprints and
// alt arts (Enchanted, Epic, Iconic, promos) are the same card. Its price is the cheapest standard printing.

import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'https://api.lorcast.com/v0';
const TCG_CATEGORY = 71; // TCGCSV / TCGplayer category for Lorcana
const OUT = new URL('../public/data/cards.json', import.meta.url);
const HEADERS = { 'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)' };
/** Rarities that are alternate art or treatments of a regular card. */
const ALT_RARITY = new Set(['Enchanted', 'Epic', 'Iconic', 'Promo']);

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// ---------------------------------------------------------------------------------------------

const sets = (await getJson(`${API}/sets`)).results;
const printings = [];
for (const s of sets) {
  printings.push(...(await getJson(`${API}/sets/${encodeURIComponent(s.code)}/cards`)));
  await new Promise((r) => setTimeout(r, 120)); // gentle
}
console.log(`Lorcast: ${printings.length} printings in ${sets.length} sets`);

// TCGplayer market prices by product id.
const prices = new Map();
for (const g of (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results) {
  try {
    for (const p of (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/prices`)).results) {
      const v = p.marketPrice ?? p.midPrice ?? p.lowPrice;
      if (v != null && (p.subTypeName === 'Normal' || !prices.has(p.productId))) prices.set(p.productId, v);
    }
  } catch (err) {
    console.warn(`  no prices for ${g.name}: ${err.message}`);
  }
}
console.log(`TCGCSV: ${prices.size} Lorcana prices`);

const byCard = new Map();
for (const p of printings) {
  const key = `${p.name}|${p.version ?? ''}`.toLowerCase();
  (byCard.get(key) ?? byCard.set(key, []).get(key)).push(p);
}

const idOf = (p) => `${p.set.code}-${p.collector_number}`;
const priceOf = (p) => (p.tcgplayer_id ? prices.get(p.tcgplayer_id) : undefined) ?? (p.prices?.usd ? Number(p.prices.usd) : null);
const cards = [];
for (const list of byCard.values()) {
  list.sort((a, b) => a.released_at.localeCompare(b.released_at) || idOf(a).localeCompare(idOf(b), undefined, { numeric: true }));
  const standard = list.filter((p) => !ALT_RARITY.has(p.rarity));
  const pool = standard.length ? standard : list;
  const main = pool[0];
  const cheapest = [...pool].filter((p) => p.tcgplayer_id).sort((a, b) => (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity))[0];

  // Legality: a card is legal in a format if any regular printing is (promo-only cards use their own).
  const judged = standard.length ? standard : list;
  const status = (f) => {
    const all = judged.map((p) => p.legalities?.[f]);
    if (list.some((p) => p.legalities?.[f] === 'banned')) return 'banned';
    return all.includes('legal') ? 'legal' : 'not_legal';
  };
  const types = main.type ?? [];

  cards.push({
    id: idOf(main),
    alt: list.length > 1 ? list.map(idOf).filter((x) => x !== idOf(main)) : undefined,
    name: main.name,
    version: main.version ?? undefined,
    // Songs are Actions with a Song subtype; treat "Song" as the type people look for.
    type: types.includes('Song') ? 'Song' : types[0] ?? 'Character',
    inks: main.inks?.length ? main.inks : main.ink ? [main.ink] : [],
    inkable: !!main.inkwell,
    cost: main.cost ?? null,
    strength: main.strength ?? null,
    willpower: main.willpower ?? null,
    lore: main.lore ?? null,
    moveCost: main.move_cost ?? null,
    classifications: main.classifications ?? [],
    keywords: main.keywords?.length ? main.keywords : undefined,
    text: main.text?.replace(/\r/g, '').trim() || undefined,
    rarity: main.rarity?.replace('_', ' '),
    set: main.set.code,
    sets: [...new Set(list.map((p) => p.set.code))],
    released: list.map((p) => p.released_at).sort()[0],
    landscape: main.layout === 'landscape' || undefined,
    core: status('core'),
    infinity: status('infinity'),
    img: main.image_uris?.digital?.normal,
    price: cheapest ? priceOf(cheapest) : null,
    tcg: cheapest?.tcgplayer_id,
  });
}
cards.sort((a, b) => a.name.localeCompare(b.name) || (a.version ?? '').localeCompare(b.version ?? ''));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), cards }));
const n = (f) => cards.filter(f).length;
console.log(
  `Wrote ${cards.length} cards (${n((c) => c.price != null)} priced, ${n((c) => c.core === 'legal')} Core-legal, ` +
    `${n((c) => c.core === 'banned' || c.infinity === 'banned')} banned, ${n((c) => c.inks.length > 1)} dual-ink)`,
);
