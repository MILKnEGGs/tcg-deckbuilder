// Downloads every Star Wars: Unlimited card from swu-db.com and today's TCGplayer prices from TCGCSV,
// and writes public/data/cards.json for the app. Run with "npm run data"; the deploy workflow runs it daily.
//
// Each card appears once, however many times it was printed. Alt arts (Hyperspace, Showcase, foils,
// promos) are dropped: a card's price is the cheapest standard printing. Its id is its first standard
// printing (e.g. "SOR_059"), so saved decks keep pointing at the same card when it's reprinted.

import { mkdirSync, writeFileSync } from 'node:fs';

const TCG_CATEGORY = 79; // TCGCSV / TCGplayer category for Star Wars: Unlimited
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
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const num = (s) => (s === undefined || s === null || s === '' || isNaN(Number(s)) ? null : Number(s));

// ---------------------------------------------------------------------------------------------
// Sets: TCGplayer's set list (oldest first) tells us which set codes to ask swu-db for.

const groups = (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results.sort((a, b) =>
  a.publishedOn.localeCompare(b.publishedOn),
);
const codes = [...new Set(groups.map((g) => g.abbreviation.trim().toLowerCase()).filter((c) => /^[a-z0-9]+$/.test(c)))];

const sets = [];
const printings = [];
await pool(codes, 4, async (code) => {
  try {
    const { data } = await getJson(`https://api.swu-db.com/cards/${code}`);
    if (!data?.length) return;
    const group = groups.find((g) => g.abbreviation.trim().toLowerCase() === code);
    sets.push({ code: code.toUpperCase(), name: group?.name ?? code.toUpperCase(), released: group?.publishedOn.slice(0, 10) ?? '' });
    printings.push(...data);
  } catch (err) {
    console.warn(`  skipped set ${code}: ${err.message}`);
  }
});
sets.sort((a, b) => a.released.localeCompare(b.released) || a.code.localeCompare(b.code));
if (!printings.length) throw new Error('swu-db returned no cards');
console.log(`swu-db: ${printings.length} printings in ${sets.length} sets`);

// ---------------------------------------------------------------------------------------------
// Prices: TCGCSV market price per TCGplayer product and printing ("Normal" or "Foil").

const prices = new Map();
let priced = 0;
await pool(groups, 4, async (g) => {
  try {
    const { results } = await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/prices`);
    for (const p of results) {
      const v = p.marketPrice ?? p.midPrice ?? p.lowPrice;
      if (v != null) prices.set(`${p.productId}|${p.subTypeName}`, v);
    }
    priced++;
  } catch (err) {
    console.warn(`  no prices for ${g.name}: ${err.message}`);
  }
});
console.log(`TCGCSV: ${prices.size} prices from ${priced}/${groups.length} sets`);

// ---------------------------------------------------------------------------------------------
// One card per name + subtitle + type.

const setOrder = new Map(sets.map((s, i) => [s.code, i]));
const byCard = new Map();
for (const p of printings) {
  if (/token/i.test(p.Type ?? '')) continue;
  const key = `${p.Name}|${p.Subtitle ?? ''}|${p.Type}`;
  (byCard.get(key) ?? byCard.set(key, []).get(key)).push(p);
}

const priceOf = (p) => {
  const fromTcg = p.tcgplayerId ? prices.get(`${p.tcgplayerId}|Normal`) : undefined;
  return fromTcg ?? num(p.MarketPrice);
};
const idOf = (p) => `${p.Set}_${p.Number}`;
const order = (a, b) => (setOrder.get(a.Set) ?? 99) - (setOrder.get(b.Set) ?? 99) || a.Number.localeCompare(b.Number);

const cards = [];
for (const all of byCard.values()) {
  all.sort(order);
  // Standard printings only; a card that was never printed plainly keeps its non-foil versions.
  let pool = all.filter((p) => p.VariantType === 'Normal');
  if (!pool.length) pool = all.filter((p) => !/foil/i.test(p.VariantType ?? ''));
  if (!pool.length) pool = all;

  const main = pool[0];
  let cheapest = null;
  for (const p of pool) {
    const v = priceOf(p);
    if (v != null && (cheapest === null || v < cheapest.price)) cheapest = { price: v, tcg: p.tcgplayerId };
  }

  const card = {
    id: idOf(main),
    name: main.Name,
    sub: main.Subtitle || undefined,
    type: main.Type,
    aspects: main.Aspects ?? [],
    traits: (main.Traits ?? []).map((t) => t.toUpperCase()),
    arenas: main.Arenas ?? [],
    keywords: main.Keywords?.length ? main.Keywords : undefined,
    cost: num(main.Cost),
    power: num(main.Power),
    hp: num(main.HP),
    text: main.FrontText || undefined,
    epic: main.EpicAction || undefined,
    back: main.BackText || undefined,
    unique: !!main.Unique,
    rarity: main.Rarity,
    set: main.Set,
    img: main.FrontArt?.replace('https://cdn.swu-db.com/images/cards/', '').replace(/\.png$/, ''),
    backImg: main.BackArt?.replace('https://cdn.swu-db.com/images/cards/', '').replace(/\.png$/, '') || undefined,
    price: cheapest?.price ?? null,
    tcg: cheapest?.tcg ? Number(cheapest.tcg) : undefined,
  };
  // Every other printing's id (including alt arts), so imported decklists naming any version still match.
  const alt = [...new Set(all.map(idOf))].filter((id) => id !== card.id);
  if (alt.length) card.alt = alt;
  cards.push(card);
}
cards.sort((a, b) => a.name.localeCompare(b.name) || (a.sub ?? '').localeCompare(b.sub ?? ''));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), sets, cards }));
const withPrice = cards.filter((c) => c.price != null).length;
console.log(`Wrote ${cards.length} cards (${withPrice} with prices) to public/data/cards.json`);
