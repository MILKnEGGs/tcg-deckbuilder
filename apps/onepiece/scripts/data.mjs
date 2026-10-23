// Builds public/data/cards.json for the One Piece app from TCGCSV (a daily copy of TCGplayer's catalog
// and prices). TCGplayer lists only English cards and has every field the builder needs (color, cost,
// power, counter, life, types, effect text), so it's the only source. Run with "npm run data"; the
// deploy workflow runs it daily.
//
// A card is one card number (e.g. "OP05-007"); the copy limit counts card numbers, so alt arts, manga
// and other parallels of the same number are the same card here. Its price is the cheapest standard
// printing, and its picture comes from that printing too.

import { mkdirSync, writeFileSync } from 'node:fs';

const TCG_CATEGORY = 68; // TCGCSV / TCGplayer category for the One Piece Card Game
const OUT = new URL('../public/data/cards.json', import.meta.url);
// TCGCSV refuses requests without a User-Agent that says who's asking.
const HEADERS = { 'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)' };

// Standard rotation. Block 1 (OP01–OP04, Starter Decks 1–10 and the promos of that time) left
// Standard on April 1, 2026. A Block 1 card stays legal if it was reprinted with a newer block icon.
// Promos have no set in their number and TCGplayer files them all in one undated "Promotion Cards" set,
// so a promo is Block 1 if TCGplayer listed it before OP05 (Awakening of the New Era): product ids
// only go up, so that's a smaller id than OP05's first card.
const BLOCK1_SETS = /^(OP0[1-4]|ST0[1-9]|ST10)-/;
const BLOCK2_SET = 'OP05';
const BLOCK2_START = '2023-12-08';
/** TCGplayer's catch-all promo set, whose date is when the set was created, not when cards came out. */
const isPromoSet = (g) => /promotion cards/i.test(g.name);

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

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

const field = (p, name) => (p.extendedData ?? []).find((e) => e.name === name)?.value;
const num = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));
const html = (s) =>
  s
    ?.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim() || undefined;
/**
 * TCGplayer's name without the bits it adds to tell printings apart:
 * "Roronoa Zoro (001)" -> "Roronoa Zoro", "Bartholomew Kuma (EB04-055)" -> "Bartholomew Kuma".
 * Parallels keep their tag ("Sabo (Alternate Art)"), which makes them longer than the standard printing.
 */
const cleanName = (n) =>
  n
    .replace(/\s+\((?:\d{3}|[A-Z]+\d*-\d+|Reprint)\)/gi, '')
    .trim();
/** TCGplayer appends a disclaimer to some card text ("This card is a reprint…", "Not Tournament Legal"). */
const splitText = (s) => {
  const t = html(s);
  if (!t) return { text: undefined, disclaimer: '' };
  const i = t.search(/\s*Disclaimer:/i);
  return i < 0 ? { text: t, disclaimer: '' } : { text: t.slice(0, i).trim() || undefined, disclaimer: t.slice(i) };
};

// ---------------------------------------------------------------------------------------------

const groups = (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results;
const products = [];
await pool(groups, 4, async (g) => {
  try {
    const [{ results: items }, { results: prices }] = await Promise.all([
      getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/products`),
      getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/prices`),
    ]);
    const price = new Map();
    for (const p of prices) {
      const v = p.marketPrice ?? p.midPrice ?? p.lowPrice;
      if (v == null) continue;
      if (p.subTypeName === 'Normal' || !price.has(p.productId)) price.set(p.productId, v);
    }
    for (const p of items) {
      const number = field(p, 'Number')?.trim().toUpperCase();
      const type = field(p, 'CardType');
      if (!number || !type || /don/i.test(type)) continue;
      products.push({ p, number, type, set: g.abbreviation.trim(), promoSet: isPromoSet(g), released: g.publishedOn.slice(0, 10), price: price.get(p.productId) ?? null });
    }
  } catch (err) {
    console.warn(`  skipped ${g.name}: ${err.message}`);
  }
});
console.log(`TCGCSV: ${products.length} card products in ${groups.length} sets`);

const byNumber = new Map();
for (const x of products) (byNumber.get(x.number) ?? byNumber.set(x.number, []).get(x.number)).push(x);

const block2FirstId = Math.min(...products.filter((x) => x.set === BLOCK2_SET).map((x) => x.p.productId));
const listedBeforeBlock2 = (list) => Math.min(...list.map((x) => x.p.productId)) < block2FirstId;

// Effect text per name, to spot Block 1 cards reprinted under a newer number.
const textKey = (x) => `${cleanName(x.p.name).replace(/\s*\([^)]*\)\s*$/, '')}|${splitText(field(x.p, 'Description')).text ?? ''}`;
const newerTexts = new Set(
  products.filter((x) => !BLOCK1_SETS.test(x.number) && (x.promoSet ? x.p.productId > block2FirstId : x.released >= BLOCK2_START)).map(textKey),
);

const cards = [];
for (const [id, list] of byNumber) {
  // The standard printing has the plain name; parallels add "(Alternate Art)", "(Manga)" and so on.
  const shortest = Math.min(...list.map((x) => cleanName(x.p.name).length));
  const standard = list.filter((x) => cleanName(x.p.name).length === shortest);
  standard.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.released.localeCompare(b.released));
  const main = standard[0];
  const p = main.p;
  // Release date from real sets; promo-only cards count as released.
  const released = list.filter((x) => !x.promoSet).map((x) => x.released).sort()[0];

  const block1 = BLOCK1_SETS.test(id) || (/^P-/.test(id) && listedBeforeBlock2(list));
  // Reprinted with a newer block icon: the same number in a Premium Booster, or the same card under a newer number.
  const reprinted = list.some((x) => /^PRB/i.test(x.set)) || newerTexts.has(textKey(main));
  const { text, disclaimer } = splitText(field(p, 'Description'));
  // Promo names also carry the event they came from: "Arlong (Sealed Battle Kit Vol. 1)". A card only
  // ever printed as a parallel keeps that tag in TCGplayer's name: "Dracule Mihawk (Manga)".
  const name = (/^P-/.test(id) ? cleanName(p.name).replace(/\s+\([^)]*\)$/, '') : cleanName(p.name))
    .replace(/\s+-\s+[A-Z]+\d*-\d+$/, '')
    .replace(/\s+\((?:Manga|Alternate Art|Parallel|SP)\)$/i, '');

  cards.push({
    id,
    name,
    type: main.type,
    colors: (field(p, 'Color') ?? '').split(/[;/]/).map((s) => s.trim()).filter(Boolean),
    cost: num(field(p, 'Cost')),
    power: num(field(p, 'Power')),
    counter: num(field(p, 'Counterplus')),
    life: num(field(p, 'Life')),
    attribute: field(p, 'Attribute') || undefined,
    traits: (field(p, 'Subtypes') ?? '').split(';').map((s) => s.trim()).filter(Boolean),
    rarity: field(p, 'Rarity') ?? '',
    text,
    set: id.replace(/-.*$/, ''),
    released,
    rotated: block1 && !reprinted ? true : undefined,
    notLegal: /not tournament legal/i.test(disclaimer) ? true : undefined,
    img: p.productId,
    price: main.price,
    tcg: p.productId,
    tcgName: p.name,
  });
}
cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), cards }));
const priced = cards.filter((c) => c.price != null).length;
const rotated = cards.filter((c) => c.rotated).length;
console.log(`Wrote ${cards.length} cards (${priced} with prices, ${rotated} rotated out of Standard) to public/data/cards.json`);
