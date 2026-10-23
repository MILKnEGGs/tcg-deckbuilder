// Downloads every Digimon Card Game card from digimoncard.io and today's TCGplayer prices from TCGCSV,
// and writes public/data/cards.json for the app. Run with "npm run data"; the deploy workflow runs it daily.
//
// Only cards released in English are kept: a card counts as English once TCGplayer lists it.
// A card is one card number (e.g. "BT1-010"); the copy limit counts card numbers, so alt arts and
// reprints of the same number are the same card here. Its price is the cheapest standard printing.

import { mkdirSync, writeFileSync } from 'node:fs';

const TCG_CATEGORY = 63; // TCGCSV / TCGplayer category for the Digimon Card Game
const OUT = new URL('../public/data/cards.json', import.meta.url);
// TCGCSV refuses requests without a User-Agent that says who's asking.
const HEADERS = { 'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)' };

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

/** Runs fn over items, a few at a time, to be polite to the APIs. */
async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

const loose = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------------------------------
// TCGplayer: every product with a card number, its price, and its set.

const groups = (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results;
const products = []; // { id, name, set, released, num, price }
await pool(groups, 4, async (g) => {
  try {
    const [{ results: items }, { results: prices }] = await Promise.all([
      getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/products`),
      getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/prices`),
    ]);
    // Normal printing if there is one; many rares only come as foil.
    const price = new Map();
    for (const p of prices) {
      const v = p.marketPrice ?? p.midPrice ?? p.lowPrice;
      if (v == null) continue;
      if (p.subTypeName === 'Normal' || !price.has(p.productId)) price.set(p.productId, v);
    }
    for (const p of items) {
      const raw = (p.extendedData ?? []).find((e) => e.name === 'Number')?.value;
      if (!raw) continue;
      // "BT26-052 C" -> "BT26-052"; a few promos are written "P - 214 P".
      const num = raw.replace(/\s*-\s*/g, '-').split(' ')[0].toUpperCase();
      products.push({ id: p.productId, name: p.name, released: g.publishedOn.slice(0, 10), num, numText: raw.split(' ')[0], price: price.get(p.productId) ?? null });
    }
  } catch (err) {
    console.warn(`  skipped ${g.name}: ${err.message}`);
  }
});
console.log(`TCGCSV: ${products.length} card products in ${groups.length} sets`);

const byNum = new Map();
for (const p of products) (byNum.get(p.num) ?? byNum.set(p.num, []).get(p.num)).push(p);

// ---------------------------------------------------------------------------------------------
// digimoncard.io: full card details.

const all = await getJson('https://digimoncard.io/api-public/search?series=Digimon%20Card%20Game');
if (!all?.length) throw new Error('digimoncard.io returned no cards');
console.log(`digimoncard.io: ${all.length} cards`);

const traitsOf = (c) => [c.digi_type, c.digi_type2, c.digi_type3, c.digi_type4, c.digi_type5].filter((t) => t && t !== 'NO DATA');
const clean = (s) => (s ? String(s).replace(/\r\n/g, '\n').replace(/ /g, ' ').trim() : undefined);
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));

const cards = [];
let japaneseOnly = 0;
const noPrice = [];
for (const c of all) {
  const id = String(c.id).toUpperCase();
  const prods = byNum.get(id);
  if (!prods) {
    japaneseOnly++;
    continue;
  }
  // Standard printings: TCGplayer's name is the card's own name, sometimes with " - BT1-010" when
  // several cards share a name. Alt arts, promos, box toppers and the like add a "(…)" suffix;
  // "(Reprint)" printings use the original art, so they count as standard.
  const name = loose(c.name);
  const base = (p) =>
    loose(
      p.name
        .replace(/\s*\/\/.*$/, '')
        .replace(/\s*\((?:reprint|resurgence booster reprint)\)\s*$/i, '')
        .replace(new RegExp(`\\s*-\\s*${p.numText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), ''),
    );
  let standard = prods.filter((p) => base(p) === name);
  if (!standard.length) standard = prods;
  standard.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.released.localeCompare(b.released));
  const cheapest = standard[0];
  const released = prods.map((p) => p.released).sort()[0];
  if (cheapest.price == null) noPrice.push(id);

  cards.push({
    id,
    name: c.name,
    type: c.type,
    colors: [c.color, c.color2].filter(Boolean),
    level: num(c.level),
    playCost: num(c.play_cost),
    digiCost: num(c.evolution_cost),
    digiFrom: c.evolution_color || c.evolution_level ? [c.evolution_color, c.evolution_level != null ? `Lv.${c.evolution_level}` : null].filter(Boolean).join(' ') : undefined,
    dp: num(c.dp),
    form: c.form || undefined,
    attribute: c.attribute || undefined,
    traits: traitsOf(c),
    rarity: String(c.rarity ?? '').toUpperCase(),
    text: clean(c.main_effect),
    inherited: clean(c.source_effect),
    special: clean([c.xros_req, c.link_requirements].filter(Boolean).join('\n')),
    // The set a card number belongs to: "BT1-010" -> "BT1", "P-009" -> "P".
    set: id.replace(/-.*$/, ''),
    released,
    price: cheapest.price,
    tcg: cheapest.id,
    tcgName: cheapest.name,
  });
}
cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), cards }));
console.log(`Wrote ${cards.length} English cards (${cards.length - noPrice.length} with prices); skipped ${japaneseOnly} not yet on TCGplayer`);
if (noPrice.length) console.log(`No price yet: ${noPrice.slice(0, 30).join(', ')}${noPrice.length > 30 ? ' …' : ''}`);
