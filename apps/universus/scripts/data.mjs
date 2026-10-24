// Builds public/data/cards.json for the UniVersus app. Cards, symbols, stats and prices come from TCGCSV
// (a daily copy of TCGplayer's catalog); attuned symbols, and the symbols of one set TCGplayer left blank,
// come from UVS Ultra (see uvsultra.mjs). Run with "npm run data"; the deploy workflow runs it daily.
//
// One card here is one game card: printings with the same name, type, symbols, difficulty and check are
// the same card (the official reprint rule), so alt arts, chrome rares and reprints share copy limits.

import { mkdirSync, writeFileSync } from 'node:fs';
import { uvsUltra } from './uvsultra.mjs';

const TCG_CATEGORY = 25; // TCGCSV / TCGplayer category for UniVersus
const OUT = new URL('../public/data/cards.json', import.meta.url);
const ULTRA_CACHE = new URL('./uvsultra.json', import.meta.url);
// TCGCSV refuses requests without a User-Agent that says who's asking.
const HEADERS = { 'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)' };

/** Which franchise (IP) a TCGplayer set belongs to. Sets mixing several IPs are null (see below). */
const IP_BY_SET = [
  [/street fighter vs\.? darkstalkers|capcom platinum|capcom casual|universus promos|cowboy bebop and trigun/i, null],
  [/darkstalkers/i, 'Darkstalkers'],
  [/world of indines|red horizon|seventh cross/i, 'UFS Originals'],
  [/street fighter/i, 'Street Fighter'],
  [/mega man/i, 'Mega Man'],
  [/cowboy bebop/i, 'Cowboy Bebop'],
  [/mortal kombat/i, 'Mortal Kombat'],
  [/soul ?calibur/i, 'SoulCalibur'],
  [/yu yu hakusho/i, 'Yu Yu Hakusho'],
  [/zenescope|grimm fairy/i, 'Grimm Fairy Tales'],
  [/my hero academia/i, 'My Hero Academia'],
  [/vox machina|mighty nein|critical role/i, 'Critical Role'],
  [/godzilla/i, 'Godzilla'],
  [/attack on titan/i, 'Attack on Titan'],
  [/tekken/i, 'TEKKEN'],
  [/star trek/i, 'Star Trek: Lower Decks'],
  [/solo leveling/i, 'Solo Leveling'],
  [/teenage mutant ninja turtles/i, 'Teenage Mutant Ninja Turtles'],
  [/guilty gear/i, 'GUILTY GEAR'],
  [/king of fighters/i, 'The King of Fighters'],
  [/fairy tail/i, 'Fairy Tail'],
];
/** What a mixed set's card is filed under when no single-IP set has it. */
const MIXED_FALLBACK = [
  [/cowboy bebop and trigun/i, 'Cowboy Bebop / Trigun'],
  [/capcom|darkstalkers/i, 'Capcom'],
  [/promo/i, 'Promos'],
];

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
const num = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));
const loose = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** A trailing "(...)" that tags a printing, not part of the card's name. */
const VARIANT =
  /\s*\((?:[^)]*(?:alternate|alt\.? art|serial|chrome|promo|foil|extra rare|platinum|textured|full art|starter|reprint|holo|pre-?release|judge|champion|exclusive|regionals?|nationals?|worlds|season|pack|kit|league|tour|store|event|participa|winner|top \d|showdown|gen ?con|expo|topper|time shifted|ptc)[^)]*|\d+|X?[SU]?R|XSR|XR|SR|UR|SEC|[A-Z]{2,}\d+[A-Z]?\d*(?:\s+\d+\/\d+)?)\)\s*$/i;
const TRAILING = /\s*\([^)]*\)\s*$/;
/**
 * TCGplayer's name without its printing tags: "MAY (Serial Numbered)" -> "MAY", "Fusion (XR)" -> "Fusion".
 * Any other trailing "(...)" goes too when the plain name exists elsewhere ("Arlong (Some Promo Event)").
 */
let plainNames = new Set();
const cleanName = (n) => {
  let s = n.trim().replace(/\s+-\s+\d+\s*\/\s*\d+$/, ''); // "Fat Gum - 75/122"
  // Peel trailing "(...)" off one at a time; keep the shortest version that's a real card's name.
  let best = s;
  for (let t = s, i = 0; i < 4 && TRAILING.test(t); i++) {
    t = t.replace(TRAILING, '');
    if (plainNames.has(loose(t))) best = t;
  }
  // Otherwise drop tags that clearly mark a printing.
  for (let i = 0; i < 3 && VARIANT.test(best); i++) best = best.replace(VARIANT, '');
  return best;
};
const SYMBOL_NAMES = ['Air', 'All', 'Chaos', 'Death', 'Earth', 'Evil', 'Fire', 'Good', 'Life', 'Order', 'Void', 'Water'];
/** "Chaos;Earth;Fire" -> ["Chaos","Earth","Fire"]; "Inf;Inf;Inf" -> ["Infinity"]. */
const symbolsOf = (raw) => {
  const out = new Set();
  for (const part of String(raw ?? '').split(/[;,]/)) {
    const s = part.trim().toLowerCase();
    if (!s) continue;
    if (s.startsWith('inf')) out.add('Infinity');
    else {
      const name = SYMBOL_NAMES.find((n) => n.toLowerCase() === s);
      if (name) out.add(name);
    }
  }
  return [...out];
};

// ---------------------------------------------------------------------------------------------

const groups = (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results;
const today = new Date().toISOString().slice(0, 10);
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
    const ipRule = IP_BY_SET.find(([re]) => re.test(g.name));
    for (const p of items) {
      const x = Object.fromEntries((p.extendedData ?? []).map((e) => [e.name, e.value]));
      if (!x.CardType || /token/i.test(x.CardType)) continue;
      products.push({
        p,
        x,
        set: g.name,
        setCode: g.abbreviation?.trim() || '',
        promoSet: /promo/i.test(g.name),
        released: g.publishedOn.slice(0, 10),
        ip: ipRule ? ipRule[1] : undefined,
        price: price.get(p.productId) ?? null,
      });
    }
  } catch (err) {
    console.warn(`  skipped ${g.name}: ${err.message}`);
  }
});
console.log(`TCGCSV: ${products.length} card products in ${groups.length} sets`);

const ultra = await uvsUltra(ULTRA_CACHE);
const attunedByName = new Map(Object.entries(ultra.attuned).map(([n, s]) => [loose(n), s]));
const symbolsByName = new Map(Object.entries(ultra.symbols).map(([n, s]) => [loose(n), s]));
console.log(`UVS Ultra: ${attunedByName.size} attuned cards, ${symbolsByName.size} filled-in symbol lists (from ${ultra.fetched.slice(0, 10)})`);

// Fill in symbols TCGplayer left blank, then group printings into cards.
plainNames = new Set(products.filter((x) => !TRAILING.test(x.p.name)).map((x) => loose(x.p.name)));
for (const x of products) {
  x.name = cleanName(x.p.name);
  x.symbols = symbolsOf(x.x.Resource);
  if (!x.symbols.length) x.symbols = symbolsByName.get(loose(x.name)) ?? [];
  x.key = [loose(x.name), x.x.CardType, [...x.symbols].sort().join('+'), x.x.Difficulty ?? '', x.x.Check ?? ''].join('|');
}
const byKey = new Map();
for (const x of products) (byKey.get(x.key) ?? byKey.set(x.key, []).get(x.key)).push(x);

// Standard: sets released this year and the two before, counting from the newest set that's out.
// ("When the first set of 2027 releases ... all sets released in 2024 will rotate out.")
const newestYear = Math.max(...products.filter((x) => !x.promoSet && x.released <= today).map((x) => Number(x.released.slice(0, 4))));
const standardFrom = newestYear - 2;

// The IP each card name has in single-IP sets, for cards in mixed sets.
const ipByName = new Map();
for (const x of products) if (x.ip) ipByName.set(loose(x.name), x.ip);

const cards = [];
const usedIds = new Set();
for (const list of byKey.values()) {
  list.sort((a, b) => a.released.localeCompare(b.released) || a.p.productId - b.p.productId);
  // The standard printing has the plain name; then cheapest.
  const shortest = Math.min(...list.map((x) => x.p.name.length));
  const standard = list.filter((x) => x.p.name.length === shortest).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const main = standard[0];
  const first = list[0];
  const x = main.x;

  // A stable id from the first printing's set number: "GDZ01 1/186" -> "GDZ01-1".
  const numMatch = /^(.*?)\s*#?(\d+[a-z]?)\s*\/\s*\d+/i.exec(first.x.Number ?? '');
  let id = numMatch ? `${(numMatch[1] || first.setCode || 'UVS').replace(/\s+/g, '')}-${numMatch[2]}` : `TCG-${first.p.productId}`;
  if (usedIds.has(id)) id = `${id}-${first.p.productId}`;
  usedIds.add(id);

  const ip = first.ip ?? list.find((y) => y.ip)?.ip ?? ipByName.get(loose(main.name)) ?? MIXED_FALLBACK.find(([re]) => re.test(first.set))?.[1] ?? 'Other';
  const real = list.filter((y) => !y.promoSet);
  const standardLegal = real.length ? real.some((y) => Number(y.released.slice(0, 4)) >= standardFrom && y.released <= today) : true;
  const released = real.map((y) => y.released).sort()[0];

  cards.push({
    id,
    name: main.name,
    type: x.CardType,
    ip,
    symbols: main.symbols,
    attuned: attunedByName.get(loose(main.name)),
    difficulty: num(x.Difficulty),
    check: num(x.Check),
    blockMod: x.BlockModifier || undefined,
    blockZone: x.BlockZone || undefined,
    speed: num(x.AttackSpeed),
    damage: x.AttackDamage || undefined,
    attackZone: x.AttackZone || undefined,
    handSize: num(x.HandSize),
    health: num(x.Vitality),
    keywords: x.Keywords ? x.Keywords.split(/\s*[•·;]\s*/).filter(Boolean) : undefined,
    text: html(x.Description),
    rarity: x.Rarity ?? '',
    set: first.set,
    released,
    standard: standardLegal || undefined,
    img: main.p.productId,
    price: main.price,
    tcg: main.p.productId,
    tcgName: main.p.name,
  });
}
cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), standardFrom, cards }));
const n = (f) => cards.filter(f).length;
console.log(
  `Wrote ${cards.length} cards (${n((c) => c.price != null)} priced, ${n((c) => c.standard)} Standard-legal from ${standardFrom}, ` +
    `${n((c) => c.attuned)} attuned, ${n((c) => !c.symbols.length)} without symbols) in ${new Set(cards.map((c) => c.ip)).size} IPs`,
);
