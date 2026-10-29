// Builds public/data/cards.json for the Fusion World app from TCGCSV (a daily copy of TCGplayer's catalog
// and prices). TCGplayer lists every English card with the fields the builder needs (color, cost, power,
// combo power, traits, text); the only thing it lacks is a picture of a leader's back, which comes from
// Bandai's own card images. Run with "npm run data"; the deploy workflow runs it daily.
//
// A card is one card number ("FB01-001"): copy limits count those, so alt arts and reprints of the same
// number are the same card here. Its price is the cheapest standard printing, and its picture comes from
// that printing too.

import { mkdirSync, writeFileSync } from 'node:fs';

const TCG_CATEGORY = 80; // TCGCSV / TCGplayer category for Dragon Ball Super Fusion World
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
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim() || undefined;
/**
 * TCGplayer's name without the bits that tell printings apart: "Vegeta - FB03-047 (Alternate Art)" and
 * "Ginyu (Judge Pack (Store Judge) 01)" -> "Vegeta", "Ginyu".
 */
const cleanName = (n) => {
  let s = n.trim();
  // A trailing "(...)", which may hold its own brackets.
  for (;;) {
    if (!s.endsWith(')')) break;
    let depth = 0;
    let i = s.length - 1;
    for (; i >= 0; i--) {
      if (s[i] === ')') depth++;
      else if (s[i] === '(' && --depth === 0) break;
    }
    if (i <= 0) break;
    s = s.slice(0, i).trim();
  }
  return s.replace(/\s+-\s+[A-Z]{2}\d{0,2}-\d{2,3}$/, '').trim();
};
/** A printing with nothing after its name: the standard one, not an alt art, gold or judge pack. */
const isStandard = (n) => !/\)\s*$/.test(n.trim());
/** TCGplayer's catch-all promo sets, whose dates are when the set was created, not when cards came out. */
const isPromoSet = (g) => /promotion cards|tournament and championship/i.test(g.name);
const BANDAI_IMG = 'https://www.dbs-cardgame.com/fw/images/cards/card/en/';
const COLOR_LETTER ={ R: 'Red', U: 'Blue', G: 'Green', Y: 'Yellow', B: 'Black' };
/** "3(RR)" -> cost 3, needing 2 red energy. */
function cost(v) {
  const m = /^(\d+)(?:\(([A-Z]*)\))?/.exec(v ?? '');
  return m ? { cost: Number(m[1]), colorCost: m[2] ?? '' } : { cost: null, colorCost: '' };
}

// ---------------------------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
const groups = (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results;
const products = [];
const types = new Map();
let early = 0;
await pool(groups, 4, async (g) => {
  // Sets on preorder: TCGplayer lists them before their cards are out (and before they're legal).
  if (g.publishedOn.slice(0, 10) > today && !isPromoSet(g)) {
    early++;
    return;
  }
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
      // Energy markers and sealed product have no card type.
      if (!number || !type) continue;
      types.set(type, (types.get(type) ?? 0) + 1);
      products.push({ p, number, type, promoSet: isPromoSet(g), released: g.publishedOn.slice(0, 10), price: price.get(p.productId) ?? null });
    }
  } catch (err) {
    console.warn(`  skipped ${g.name}: ${err.message}`);
  }
});
console.log(
  `TCGCSV: ${products.length} card products in ${groups.length - early} sets (${early} not out yet); types: ${[...types].map(([t, n]) => `${t} ${n}`).join(', ')}`,
);

const byNumber = new Map();
for (const x of products) (byNumber.get(x.number) ?? byNumber.set(x.number, []).get(x.number)).push(x);

const cards = [];
for (const [id, list] of byNumber) {
  const standard = list.filter((x) => isStandard(x.p.name));
  const pick = (standard.length ? standard : list).slice();
  pick.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.released.localeCompare(b.released));
  const main = pick[0];
  const p = main.p;
  // The name most printings agree on (one TCGplayer listing names FB07-013 after a different card).
  const names = new Map();
  for (const x of list) {
    const n = cleanName(x.p.name);
    names.set(n, (names.get(n) ?? 0) + 1);
  }
  const name = [...names].sort((a, b) => b[1] - a[1])[0][0];
  const text = field(p, 'Description');
  const traits = (field(p, 'Character Traits') ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  const paid = cost(field(p, 'Cost'));
  let colors = (field(p, 'Color') ?? list.map((x) => field(x.p, 'Color')).find(Boolean) ?? '').split(';').filter(Boolean);
  // Every card is one color, which its cost names: TCGplayer lists FB08-011 (a red card, cost "2(R)") as
  // Red;Black, which would keep it out of every deck.
  if (colors.length > 1 && paid.colorCost) colors = [...new Set([...paid.colorCost].map((l) => COLOR_LETTER[l]).filter(Boolean))];
  // TCGplayer calls a few battle cards leaders (FB10-085 Bido, FS08-06); real leaders have the Leader rarity
  // and no cost.
  const type = main.type === 'Leader' && (field(p, 'Rarity') !== 'Leader' || paid.cost != null) ? 'Battle' : main.type;

  const card = {
    id,
    name,
    type,
    colors,
    ...paid,
    power: null,
    combo: num(field(p, 'Combo Power')),
    traits,
    rarity: field(p, 'Rarity') ?? '',
    set: id.split('-')[0],
    released: list.filter((x) => !x.promoSet).map((x) => x.released).sort()[0],
    img: p.productId,
    price: main.price,
    tcg: p.productId,
    tcgName: p.name,
  };

  if (type === 'Leader') {
    // Leaders are two-sided: "Shallot/Giblet // Shallet", power "15000/20000", and the back's text after
    // "Awaken" in bold. Some leaders keep their name when they flip.
    const [front, back] = name.split(/\s+\/\/\s+/);
    const [powerFront, powerBack] = (field(p, 'Power') ?? '').split('/').map(num);
    // The heading is sometimes typed "<strong>Awaken</strong" or "<strong>Awaken<strong>".
    const [textFront, textBack] = (text ?? '').split(/<strong>\s*Awaken\s*<\/?strong>?/i);
    card.name = front;
    card.power = powerFront ?? null;
    card.text = html(textFront);
    // TCGplayer's leader pictures are of either side (FB01-001's is the awakened one), so both sides come
    // from Bandai's card images.
    card.front = `${BANDAI_IMG}${id}_f.webp`;
    card.back = { name: back ?? front, power: powerBack ?? null, text: html(textBack), img: `${BANDAI_IMG}${id}_b.webp` };
  } else {
    card.power = num(field(p, 'Power'));
    card.text = html(text);
  }
  cards.push(card);
}
cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), cards }));
const priced = cards.filter((c) => c.price != null).length;
console.log(`Wrote ${cards.length} cards (${cards.filter((c) => c.type === 'Leader').length} leaders, ${priced} with prices) to public/data/cards.json`);
