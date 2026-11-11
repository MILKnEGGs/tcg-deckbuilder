// Builds public/data/cards.json for the Alpha Clash app from TCGCSV (a daily copy of TCGplayer's catalog and
// prices). TCGplayer lists every card with what deck building needs: type, subtype, color, cost, attack and
// defense, character name, planet, affiliation and text (where the deck building restrictions and Unrivaled
// are printed). It lacks a Contender's role symbol (Destroyer, Savior, Sentinel) and starting health, so the
// app asks for the role per deck. Run with "npm run data"; the deploy workflow runs it daily.
//
// A card is its English name: the 4-copy limit counts names (rule 100.2b), so reprints, promos and alt arts
// are the same card. Its id is the number of its first regular printing ("AC1-071"); its price is the
// cheapest standard printing.

import { mkdirSync, writeFileSync } from 'node:fs';

const TCG_CATEGORY = 78; // TCGCSV / TCGplayer category for Alpha Clash
const OUT = new URL('../public/data/cards.json', import.meta.url);
// TCGCSV refuses requests without a User-Agent that says who's asking.
const HEADERS = { 'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)' };
const DECK_TYPES = new Set(['Contender', 'Clashground', 'Clash', 'Accessory', 'Action']);
/** The Vault Trials' boss deck pieces: played by the raid, not put in your deck. */
const BOSS_SUBTYPES = new Set(['Omen', 'Event', 'Minion', 'Elite Minion', 'Guardian Minion']);
const GEM = { B: 'Black', G: 'Green', W: 'White', U: 'Blue', R: 'Red' };

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
const list = (v) => (v ?? '').split(';').map((s) => s.trim()).filter(Boolean);
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
/** "Moxie, Ready to Hunt (Pre-Release Champion)" -> "Moxie, Ready to Hunt". */
const cleanName = (n) => {
  let s = n.trim();
  while (/\([^()]*\)$/.test(s)) s = s.replace(/\s*\([^()]*\)$/, '').trim();
  return s.replace(/\s+/g, ' ');
};
/** A printing with nothing after its name: the regular one, not a promo, gold, ink or iconic art. */
const isStandard = (n) => !/\)\s*$/.test(n.trim());
/** "KS AC1-005 IA", "AC8-001 (C)", "VTD1-004 (P) Black" -> "AC1-005", "AC8-001", "VTD1-004". */
const numberOf = (v) => /([A-Za-z]+\d*-[A-Z]?\d+[a-z]?)/.exec(v ?? '')?.[1]?.toUpperCase();
/** TCGplayer's catch-all promo set, whose date is when the set was created, not when cards came out. */
const isPromoSet = (g) => /promo/i.test(g.name);
/** "BB3" -> cost 3, paid with two black gems. "GX" -> cost X. */
function cost(v) {
  const m = /^([BGWUR]*)(\d+|X)$/i.exec((v ?? '').trim());
  if (!m) return { cost: null, gems: '' };
  return { cost: m[2].toUpperCase() === 'X' ? 0 : Number(m[2]), gems: m[1].toUpperCase() };
}
/**
 * Deck building keywords, from text lines of comma-separated keywords ("Breakthrough, Unrivaled"):
 * "non-Unrivaled Relic" and "without Unrivaled" in rules text don't count.
 */
function deckKeywords(text) {
  const out = new Set();
  for (const line of (text ?? '').split('\n')) {
    for (const raw of line.replace(/\([^)]*\)?/g, '').split(',')) {
      const t = raw.trim().replace(/\s+/g, ' ');
      if (/^unrivaled$/i.test(t)) out.add('Unrivaled');
      else if (/^rivaled$/i.test(t)) out.add('Rivaled');
      else if (/^exclusive$/i.test(t)) out.add('Exclusive');
    }
    // "Unrivaled Attach: …": the keyword line ran into the next one.
    if (/^un ?rivaled\b(?!\s+(card|cards|relic|action|weapon|accessory|clash))/i.test(line.trim())) out.add('Unrivaled');
  }
  return [...out];
}
/**
 * The deck building restriction: names or role symbols in brackets at the very top of the text
 * ("[(Destroyer)]/[Khagan], Breakthrough"). Each alternative is one name; the Contender must match one.
 */
function restriction(text) {
  const m = /^\s*((?:\[[^\]\n]*\]?\s*(?:[/,]|or)?\s*)+)/i.exec(text ?? '');
  if (!m) return undefined;
  const alts = m[1]
    .split(/[/,\]\[]|\bor\b/i)
    .map((s) => s.replace(/[()]/g, '').replace(/\bsymbol\b/gi, '').trim())
    .filter(Boolean)
    // "[Exclusive]" and keywords in brackets aren't restrictions.
    .filter((s) => !/^(exclusive|unrivaled|rivaled)$/i.test(s));
  return alts.length ? [...new Set(alts)] : undefined;
}

// ---------------------------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
const groups = (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results;
const products = [];
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
      const type = field(p, 'CardType');
      const number = numberOf(field(p, 'Number'));
      // Sealed product, tokens, bosses and role cards.
      if (!number || !DECK_TYPES.has(type)) continue;
      if (BOSS_SUBTYPES.has(field(p, 'CardSubtype'))) continue;
      products.push({ p, number, type, set: g.abbreviation, promoSet: isPromoSet(g), released: g.publishedOn.slice(0, 10), price: price.get(p.productId) ?? null });
    }
  } catch (err) {
    console.warn(`  skipped ${g.name}: ${err.message}`);
  }
});
console.log(`TCGCSV: ${products.length} card products in ${groups.length - early} sets (${early} not out yet)`);

// Printings sharing a name are one card, and so are cards of the same type whose names are one typo apart
// ("Zhao Li, Reconaissance Agent", "Clarity, Harbiner of Darkness", "Lunarblade", "Grant Park Chicago"):
// TCGplayer misspells some reprints, and the 4-copy limit and ban list go by the real name. Real cards
// that differ by one letter have different types ("Clarify" is an Action, "Clarity" a Clash card), and
// card numbers alone don't do: TCGplayer gives some Year of the Dragon cards another card's number.
const key = (n) => cleanName(n).toLowerCase().replace(/[’‘`]/g, "'");
/** Edit distance at most 1 (a swap of neighbours counts as one), ignoring spaces and punctuation. */
function typoApart(a, b) {
  a = a.replace(/[^a-z0-9]/g, '');
  b = b.replace(/[^a-z0-9]/g, '');
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const [x, y] = [a.slice(i), b.slice(i)];
  return x.slice(1) === y.slice(1) || x.slice(1) === y || x === y.slice(1) || (x[0] === y[1] && x[1] === y[0] && x.slice(2) === y.slice(2));
}
const parent = new Map();
const find = (k) => {
  while (parent.get(k) !== k) k = parent.get(k);
  return k;
};
const join = (a, b) => {
  for (const k of [a, b]) if (!parent.has(k)) parent.set(k, k);
  parent.set(find(a), find(b));
};
const typeOf = new Map();
for (const x of products) {
  join(`name:${key(x.p.name)}`, `name:${key(x.p.name)}`);
  typeOf.set(key(x.p.name), x.type);
}
const names = [...typeOf.keys()];
for (let i = 0; i < names.length; i++)
  for (let j = i + 1; j < names.length; j++)
    if (typeOf.get(names[i]) === typeOf.get(names[j]) && typoApart(names[i], names[j])) join(`name:${names[i]}`, `name:${names[j]}`);
const byName = new Map();
for (const x of products) {
  const k = find(`name:${key(x.p.name)}`);
  (byName.get(k) ?? byName.set(k, []).get(k)).push(x);
}
/** Misspellings that no other spelling outvotes. */
const NAME_FIXES = { 'Amalgamight, Moprhic Enforcer': 'Amalgamight, Morphic Enforcer' };
/** How many different card names use each word: a misspelled word ("Maser") is used by one. */
const wordUse = new Map();
for (const n of new Set(products.map((x) => cleanName(x.p.name))))
  for (const w of new Set(n.toLowerCase().match(/[a-z]+/g) ?? [])) wordUse.set(w, (wordUse.get(w) ?? 0) + 1);
const rarestWord = (n) => Math.min(...(n.toLowerCase().match(/[a-z]+/g) ?? ['']).map((w) => wordUse.get(w) ?? 0));
/** The name most printings agree on; on a tie, the one spelled like other cards, then the first printing's. */
const commonName = (printings) => {
  const count = new Map();
  for (const x of [...printings].sort(order)) count.set(cleanName(x.p.name), (count.get(cleanName(x.p.name)) ?? 0) + 1);
  const name = [...count].sort((a, b) => b[1] - a[1] || rarestWord(b[0]) - rarestWord(a[0]))[0][0];
  return NAME_FIXES[name] ?? name;
};

const order = (a, b) =>
  Number(a.promoSet) - Number(b.promoSet) || a.released.localeCompare(b.released) || a.number.localeCompare(b.number, undefined, { numeric: true });

const cards = [];
for (const printings of byName.values()) {
  const standard = printings.filter((x) => isStandard(x.p.name));
  const regular = (standard.length ? standard : printings).slice().sort(order);
  // The id and card details come from the first regular printing; the price from the cheapest.
  const first = regular[0];
  const cheapest = [...regular].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || order(a, b))[0];
  // Details from the printing with the most fields filled in (some promos list only a few).
  const p = [...printings].sort((a, b) => (b.p.extendedData?.length ?? 0) - (a.p.extendedData?.length ?? 0) || order(a, b))[0].p;
  const text = html(field(p, 'Description'));
  const paid = cost(field(p, 'Resource Cost'));
  let colors = list(field(p, 'Color'));
  if (!colors.length) colors = [...new Set([...paid.gems].map((g) => GEM[g]))];
  const subtypes = list(field(p, 'CardSubtype'));

  cards.push({
    id: first.number,
    alt: [...new Set(printings.map((x) => x.number))].filter((n) => n !== first.number),
    name: commonName(printings),
    type: first.type,
    subtypes: subtypes.length ? subtypes : undefined,
    colors,
    ...paid,
    attack: num(field(p, 'Attack')),
    defense: num(field(p, 'Defense')),
    character: field(p, 'Character Name') || undefined,
    planet: field(p, 'Planet Name') || undefined,
    location: field(p, 'Location Name') || undefined,
    affiliations: list(field(p, 'Affiliation')),
    keywords: deckKeywords(text),
    restriction: restriction(text),
    text,
    rarity: field(first.p, 'Rarity') ?? '',
    set: first.set,
    sets: [...new Set(printings.map((x) => x.set))],
    released: (printings.filter((x) => !x.promoSet).length ? printings.filter((x) => !x.promoSet) : printings).map((x) => x.released).sort()[0],
    img: cheapest.p.productId,
    price: cheapest.price,
    tcg: cheapest.p.productId,
    tcgName: cheapest.p.name,
  });
}
for (const c of cards) if (!c.alt.length) delete c.alt;

// Two-sided Contenders that TCGplayer lists as one product per side: one card here, front and back, with
// the colors and names of both (rule 100.2g.1). Front first.
const TWO_SIDED = [['Shadowlight, Bright Beacon', 'Shadowlight, Dark Absence']];
for (const [frontName, backName] of TWO_SIDED) {
  const front = cards.find((c) => c.name === frontName);
  const back = cards.find((c) => c.name === backName);
  if (!front || !back) {
    console.warn(`  two-sided Contender not found: ${frontName} / ${backName}`);
    continue;
  }
  front.back = { name: back.name, text: back.text, colors: back.colors, attack: back.attack, defense: back.defense, img: back.img };
  front.colors = [...new Set([...front.colors, ...back.colors])];
  front.affiliations = [...new Set([...front.affiliations, ...back.affiliations])];
  front.alt = [...new Set([...(front.alt ?? []), back.id, ...(back.alt ?? [])])];
  cards.splice(cards.indexOf(back), 1);
}

// Ids are unique: where TCGplayer gave two cards one number, the later card takes its next printing's
// number, or the number plus "b". Sorting by first release first keeps this stable as sets come out.
cards.sort((a, b) => a.released.localeCompare(b.released) || a.id.localeCompare(b.id, undefined, { numeric: true }) || a.name.localeCompare(b.name));
const ids = new Map();
for (const c of cards) {
  if (ids.has(c.id)) {
    const was = c.id;
    c.id = [...(c.alt ?? [])].find((n) => !ids.has(n)) ?? `${was}b`;
    c.alt = [...new Set([was, ...(c.alt ?? [])])].filter((n) => n !== c.id);
    console.warn(`  ${ids.get(was)} and ${c.name} share number ${was}; ${c.name} is ${c.id} here`);
  }
  ids.set(c.id, c.name);
}
cards.sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), cards }));
const n = (f) => cards.filter(f).length;
console.log(
  `Wrote ${cards.length} cards (${n((c) => c.type === 'Contender')} Contenders, ${n((c) => c.price != null)} priced, ` +
    `${n((c) => c.restriction)} with deck building restrictions, ${n((c) => c.keywords.includes('Unrivaled'))} Unrivaled, ` +
    `${n((c) => c.keywords.includes('Rivaled'))} Rivaled)`,
);
