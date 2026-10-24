// Builds public/data/cards.json for the Star Wars Destiny app. Cards and every format's rules come from
// the community "A Renewed Hope" (ARH) database (db.swdrenewedhope.com), which keeps the game going
// since Fantasy Flight ended it in 2020; prices come from TCGCSV (TCGplayer), which only has the official
// Fantasy Flight sets. Run with "npm run data"; the deploy workflow runs it daily.
//
// Reprints are folded into the card they reprint (same card for copy limits), keeping every set they
// were printed in, so format legality is "printed in any of the format's sets".

import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'https://db.swdrenewedhope.com/api/public';
const TCG_CATEGORY = 26; // TCGCSV / TCGplayer category for Star Wars: Destiny
const OUT = new URL('../public/data/cards.json', import.meta.url);
const HEADERS = { 'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)' };

/** ARH set code -> TCGplayer set name, for the official sets TCGplayer sells. */
const TCG_SETS = {
  AW: 'Awakenings',
  SoR: 'Spirit of Rebellion',
  EaW: 'Empire at War',
  TPG: 'Two-Player Game',
  LEG: 'Legacies',
  RIV: 'Rivals',
  WotF: 'Way of the Force',
  AtG: 'Across the Galaxy',
  CONV: 'Convergence',
  AoN: 'Allies of Necessity',
  SoH: 'Spark of Hope',
  CM: 'Covert Missions',
};

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

const html = (s) =>
  s
    ?.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim() || undefined;

// ---------------------------------------------------------------------------------------------

const [raw, sets, formats] = await Promise.all([getJson(`${API}/cards`), getJson(`${API}/sets`), getJson(`${API}/formats`)]);
console.log(`ARH: ${raw.length} cards, ${sets.length} sets, ${formats.length} formats`);
const setByCode = new Map(sets.map((s) => [s.code, s]));

// TCGplayer prices for official cards, by set name + collector number.
const tcg = new Map(); // "Awakenings|21" -> { id, name, price }
const groups = (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results;
for (const g of groups) {
  if (!Object.values(TCG_SETS).includes(g.name)) continue;
  const [{ results: items }, { results: prices }] = await Promise.all([
    getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/products`),
    getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/prices`),
  ]);
  const price = new Map();
  for (const p of prices) {
    const v = p.marketPrice ?? p.midPrice ?? p.lowPrice;
    if (v != null && (p.subTypeName === 'Normal' || !price.has(p.productId))) price.set(p.productId, v);
  }
  for (const p of items) {
    const number = parseInt((p.extendedData ?? []).find((e) => e.name === 'Number')?.value ?? '', 10);
    if (!isNaN(number)) tcg.set(`${g.name}|${number}`, { id: p.productId, name: p.name, price: price.get(p.productId) ?? null });
  }
}
console.log(`TCGCSV: ${tcg.size} official Destiny products`);

// The far side of flip cards ("13003B") isn't a card you build with; the A side carries it.
const cards = raw.filter((c) => !/B$/.test(c.code));
const backs = new Map(raw.filter((c) => /B$/.test(c.code)).map((c) => [c.code.replace(/B$/, 'A'), c]));
/** Fantasy Flight's own free print-and-play set (12 double-sided cards, July 2020); TCGplayer never sold it. */
const FFG_PNP_SETS = new Set(['TR']);
const byCode = new Map(cards.map((c) => [c.code, c]));
// Fold reprints into the original.
const original = (c) => {
  let o = c;
  for (let i = 0; i < 5 && o.reprint_of && byCode.has(o.reprint_of); i++) o = byCode.get(o.reprint_of);
  return o;
};
const printings = new Map();
for (const c of cards) {
  const o = original(c);
  (printings.get(o.code) ?? printings.set(o.code, []).get(o.code)).push(c);
}

// Format rules per card: legal, banned, restricted, balance points, restricted partners.
const fmt = formats.map((f) => ({
  code: f.code,
  sets: new Set(f.data.sets ?? []),
  banned: new Set((f.data.banned ?? []).map((c) => c.replace(/B$/, 'A'))),
  restricted: new Set(f.data.restricted ?? []),
  balance: f.data.balance ?? {},
  pairs: f.data.restrictedPairs ?? {},
}));

const out = [];
for (const [code, list] of printings) {
  const c = byCode.get(code);
  const codes = list.map((p) => p.code);
  const setCodes = [...new Set(list.map((p) => p.set_code))];
  const per = (pick) => Object.fromEntries(fmt.map((f) => [f.code, pick(f)]).filter(([, v]) => v !== undefined && v !== false));

  // Cheapest official printing on TCGplayer.
  let best = null;
  for (const p of list) {
    const setName = TCG_SETS[p.set_code];
    const hit = setName && tcg.get(`${setName}|${p.position}`);
    if (hit && (!best || (hit.price ?? Infinity) < (best.price ?? Infinity))) best = hit;
  }

  const back = backs.get(code);
  const sold = setCodes.some((s) => TCG_SETS[s]);
  out.push({
    id: code,
    alt: codes.filter((x) => x !== code).length ? codes.filter((x) => x !== code) : undefined,
    name: c.name,
    sub: c.subtitle || undefined,
    type: c.type_code,
    affiliation: c.affiliation_code,
    color: c.faction_code,
    subtypes: (c.subtypes ?? []).map((s) => s.code),
    unique: !!c.is_unique,
    points: c.points ?? undefined,
    cost: c.cost ?? null,
    health: c.health ?? null,
    sides: c.has_die ? c.sides : undefined,
    text: html(c.text),
    limit: c.deck_limit ?? 2,
    rarity: c.rarity_code,
    set: c.set_code,
    sets: setCodes,
    released: setCodes.map((s) => setByCode.get(s)?.available).filter(Boolean).sort()[0],
    pnp: sold ? undefined : true,
    ffg: !sold && setCodes.some((s) => FFG_PNP_SETS.has(s)) ? true : undefined,
    flip: c.flip_card || undefined,
    img: c.imagesrc,
    // The far side of a double-sided card (Transformations, flip cards): shown with "Show back" and searchable.
    back: back ? { name: back.name, sub: back.subtitle || undefined, type: back.type_code, img: back.imagesrc, text: html(back.text) } : undefined,
    // Per-format rules, keyed by format code.
    legal: Object.keys(per((f) => codes.some((x) => list.find((p) => p.code === x && f.sets.has(p.set_code))) || undefined)),
    banned: Object.keys(per((f) => codes.some((x) => f.banned.has(x)) || undefined)),
    restricted: Object.keys(per((f) => codes.some((x) => f.restricted.has(x)) || undefined)),
    balance: Object.keys(per((f) => codes.find((x) => f.balance[x]) && f.balance[codes.find((x) => f.balance[x])])).length
      ? per((f) => {
          const x = codes.find((y) => f.balance[y]);
          return x ? f.balance[x] : undefined;
        })
      : undefined,
    pairs: Object.keys(per((f) => codes.some((x) => f.pairs[x]) || undefined)).length
      ? per((f) => {
          const others = codes.flatMap((x) => f.pairs[x] ?? []);
          return others.length ? others.map((o) => original(byCode.get(o) ?? { code: o }).code) : undefined;
        })
      : undefined,
    price: best?.price ?? null,
    tcg: best?.id,
    tcgName: best?.name,
  });
}
for (const c of out) for (const k of ['banned', 'restricted']) if (!c[k].length) delete c[k];
out.sort((a, b) => a.name.localeCompare(b.name) || (a.sub ?? '').localeCompare(b.sub ?? ''));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), cards: out }));
const n = (f) => out.filter(f).length;
console.log(`Wrote ${out.length} cards (${n((c) => c.price != null)} priced, ${n((c) => c.tcg)} on TCGplayer, ${n((c) => c.pnp)} print & play) to public/data/cards.json`);
