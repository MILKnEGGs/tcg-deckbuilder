// Builds public/data/cards.json for the Union Arena app from TCGCSV (a daily copy of TCGplayer's catalog
// and prices). TCGplayer lists only English cards and has every field the builder needs (series, energy,
// AP cost, BP, trigger, effect text), so it's the only source. Run with "npm run data"; the deploy
// workflow runs it daily.
//
// A card is one card number, the part after "/" ("UE22BT/CSM-1-001" -> "CSM-1-001"): copy limits count
// those, so alt arts and reprints of the same number are the same card here. Its price is the cheapest
// standard printing, and its picture comes from that printing too.

import { mkdirSync, writeFileSync } from 'node:fs';

const TCG_CATEGORY = 81; // TCGCSV / TCGplayer category for Union Arena
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
    .replace(/\n{2,}/g, '\n')
    .trim() || undefined;
/** TCGplayer's name without the bits that tell printings apart: "Denji (003)" -> "Denji". */
const cleanName = (n) => n.replace(/\s+\((?:\d{3}|Reprint)\)/gi, '').trim();
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
/** TCGplayer's catch-all promo set, whose date is when the set was created, not when cards came out. */
const isPromoSet = (g) => /promotion cards/i.test(g.name);

// ---------------------------------------------------------------------------------------------

const groups = (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results;
const products = [];
const types = new Map();
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
      const full = field(p, 'Number')?.trim().toUpperCase();
      const type = field(p, 'CardType');
      if (!full || !type) continue;
      types.set(type, (types.get(type) ?? 0) + 1);
      // AP cards sit beside the deck and are the same for everyone.
      if (/action point|^ap\b/i.test(type)) continue;
      // A promo or two runs its set code into the title code ("UEPRSLG-1-018"); keep the last 3.
      const number = (full.includes('/') ? full.slice(full.indexOf('/') + 1) : full).replace(/^[A-Z0-9]+([A-Z0-9]{3}-[^-]+-[^-]+)$/, '$1');
      products.push({ p, number, type, promoSet: isPromoSet(g), released: g.publishedOn.slice(0, 10), price: price.get(p.productId) ?? null });
    }
  } catch (err) {
    console.warn(`  skipped ${g.name}: ${err.message}`);
  }
});
console.log(`TCGCSV: ${products.length} card products in ${groups.length} sets; types: ${[...types].map(([t, n]) => `${t} ${n}`).join(', ')}`);

const byNumber = new Map();
for (const x of products) (byNumber.get(x.number) ?? byNumber.set(x.number, []).get(x.number)).push(x);

const cards = [];
for (const [id, list] of byNumber) {
  // The standard printing has the plain name; parallels add "(Alternate Art)", "(Super Rare)" and so on.
  const shortest = Math.min(...list.map((x) => cleanName(x.p.name).length));
  const standard = list.filter((x) => cleanName(x.p.name).length === shortest);
  standard.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.released.localeCompare(b.released));
  const main = standard[0];
  const p = main.p;
  const trigger = html(field(p, 'Trigger'));

  cards.push({
    id,
    name: cleanName(p.name).replace(/\s+\((?:Alternate Art|Parallel|Super Rare)\)$/i, ''),
    type: main.type,
    // "CSM-1-001" -> title code "CSM" (3 characters; a promo may run its set code into it); the deck
    // must be all one title.
    title: /([A-Z0-9]{3})-[^-]+-[^-]+$/.exec(id)?.[1] ?? id.split('-')[0],
    series: field(p, 'SeriesName') ?? '',
    color: field(p, 'ActivationEnergy') || undefined,
    energy: num(field(p, 'RequiredEnergy')),
    ap: num(field(p, 'ActionPointCost')),
    bp: field(p, 'BattlePointBP') || undefined,
    generates: field(p, 'GeneratedEnergy') || undefined,
    // "[Draw] Draw a card." -> "Draw"; the deck may hold at most 4 each of Special, Color and Final.
    trigger: trigger ? titleCase(/^\[([^\]]+)\]/.exec(trigger)?.[1] ?? 'Other') : undefined,
    triggerText: trigger,
    rarity: field(p, 'Rarity') ?? '',
    text: html(field(p, 'Description')),
    released: list.filter((x) => !x.promoSet).map((x) => x.released).sort()[0],
    img: p.productId,
    price: main.price,
    tcg: p.productId,
    tcgName: p.name,
  });
}
cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

// TCGplayer spells some series differently on a few cards ("Code Geass", "My Hero Acadamia"):
// every card of a title gets the name most of that title's cards use.
const seriesVotes = new Map();
for (const c of cards) {
  const votes = seriesVotes.get(c.title) ?? seriesVotes.set(c.title, new Map()).get(c.title);
  if (c.series && c.series !== c.title) votes.set(c.series, (votes.get(c.series) ?? 0) + 1);
}
const SPELLING = { 'My Hero Acadamia': 'My Hero Academia' };
for (const c of cards) {
  const votes = [...(seriesVotes.get(c.title) ?? [])].sort((a, b) => b[1] - a[1]);
  c.series = votes[0]?.[0] ?? c.title;
  c.series = SPELLING[c.series] ?? c.series;
}

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), cards }));
const priced = cards.filter((c) => c.price != null).length;
console.log(`Wrote ${cards.length} cards in ${new Set(cards.map((c) => c.title)).size} titles (${priced} with prices) to public/data/cards.json`);
