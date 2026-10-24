// Builds public/data/cards.json for the Pokémon app. Cards, regulation marks and Standard/Expanded
// legality come from TCGdex (its GraphQL API); prices from TCGCSV (TCGplayer), matched by set and card
// number; Pokémon TCG Live set codes for the newest sets from pokemontcg.io's set list. Run with
// "npm run data"; the deploy workflow runs it daily.
//
// Only cards legal in Expanded (Black & White onward) are kept. A card is one name plus its game text:
// reprints and alt arts (illustration rares, secret rares numbered past the set's official count) are
// the same card, priced at the cheapest standard printing. Copy limits count names, not cards.

import { mkdirSync, writeFileSync } from 'node:fs';

const GQL = 'https://api.tcgdex.net/v2/graphql';
const TCG_CATEGORY = 3; // TCGCSV / TCGplayer category for Pokémon (English)
const OUT = new URL('../public/data/cards.json', import.meta.url);
const HEADERS = { 'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)' };
/** Black & White-era ACE SPEC cards, which TCGdex doesn't mark (newer ones have an "ACE SPEC Rare" rarity). */
const OLD_ACE_SPECS = [
  'Computer Search', 'Crystal Edge', 'Crystal Wall', 'Dowsing Machine', 'Gold Potion', 'Victory Piece', 'Life Dew',
  'Rock Guard', 'Scramble Switch', 'Master Ball', 'Scoop Up Cyclone', 'G Booster', 'G Scope',
];

async function request(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
let skippedEntries = 0;
const gql = async (query) => {
  const r = await request(GQL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  // A few cards have a blank attack name, which GraphQL reports as an error while still returning the
  // rest of the page (the bad entry comes back as null). Keep the page; skip only those entries.
  if (r.errors && !r.data) throw new Error(JSON.stringify(r.errors).slice(0, 300));
  if (r.errors) skippedEntries += r.errors.length;
  return r.data;
};
const loose = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------------------------------
// Sets and cards from TCGdex.

const { sets } = await gql('{ sets { id name releaseDate tcgOnline cardCount { official } } }');
const setById = new Map(sets.map((s) => [s.id, s]));

const FIELDS = `id localId name category stage hp types evolveFrom trainerType energyType regulationMark rarity suffix
  legal { standard expanded } set { id } image effect retreat
  abilities { type name effect } attacks { name cost damage effect } weaknesses { type value }`;
const printings = [];
for (let page = 1; page < 40; page++) {
  const { cards } = await gql(`{ cards(pagination: {page: ${page}, itemsPerPage: 2000}, filters: {}) { ${FIELDS} } }`);
  if (!cards) throw new Error(`TCGdex returned no cards for page ${page}`);
  printings.push(...cards.filter(Boolean));
  if (cards.length < 2000) break;
}
const expanded = printings.filter((p) => p.legal?.expanded);
console.log(`TCGdex: ${printings.length} printings, ${expanded.length} legal in Expanded, ${sets.length} sets (${skippedEntries} malformed entries skipped)`);

// Pokémon TCG Live set codes, for the decklist format; pokemontcg.io has them for the newest sets.
const ptcgo = new Map();
try {
  for (const s of (await request('https://api.pokemontcg.io/v2/sets?pageSize=250')).data) if (s.ptcgoCode) ptcgo.set(loose(s.name), s.ptcgoCode);
} catch (err) {
  console.warn(`  pokemontcg.io sets unavailable (${err.message}); newest sets will export without codes`);
}
const codeOf = (set) => set?.tcgOnline ?? ptcgo.get(loose(set?.name)) ?? null;

// ---------------------------------------------------------------------------------------------
// TCGplayer prices, by set name and card number.

const groups = (await request(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results;
const groupKey = (name) => loose(name.replace(/^(?:[A-Z]{1,4}\d*[a-z]?\d*(?:\.\d)?\s*[:\-]\s*)/, '').replace(/\bblack star promos?\b/i, 'promos'));
const groupsByKey = new Map(groups.map((g) => [groupKey(g.name), g]));
const products = new Map(); // `${groupId}|${number}` -> { id, price }
const wanted = new Set(expanded.map((p) => groupsByKey.get(groupKey(setById.get(p.set.id)?.name ?? ''))?.groupId).filter(Boolean));
for (const g of groups) {
  if (!wanted.has(g.groupId)) continue;
  try {
    const [{ results: items }, { results: prices }] = await Promise.all([
      request(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/products`),
      request(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/prices`),
    ]);
    const price = new Map();
    for (const p of prices) {
      const v = p.marketPrice ?? p.midPrice ?? p.lowPrice;
      if (v != null && (p.subTypeName === 'Normal' || p.subTypeName === 'Holofoil' || !price.has(p.productId))) price.set(p.productId, v);
    }
    for (const p of items) {
      const raw = (p.extendedData ?? []).find((e) => e.name === 'Number')?.value;
      if (!raw) continue;
      const num = raw.split('/')[0].trim().replace(/^0+(?=\d)/, '').toLowerCase();
      const key = `${g.groupId}|${num}`;
      // Prefer the plain product over "(Reverse Holo)"-style duplicates.
      if (!products.has(key) || p.name.length < products.get(key).name.length) products.set(key, { id: p.productId, name: p.name, price: price.get(p.productId) ?? null });
    }
  } catch (err) {
    console.warn(`  no TCGplayer data for ${g.name}: ${err.message}`);
  }
}
const tcgOf = (p) => {
  const g = groupsByKey.get(groupKey(setById.get(p.set.id)?.name ?? ''));
  return g ? products.get(`${g.groupId}|${String(p.localId).replace(/^0+(?=\d)/, '').toLowerCase()}`) : undefined;
};

// ---------------------------------------------------------------------------------------------
// One card per name + game text.

/** Basic Energy is one card per type, however it's printed ("Fire Energy", "Basic Fire Energy"). */
// TCGdex's energyType isn't reliable for newer Special Energy, so go by the exact basic names.
const isBasicEnergy = (p) => p.category === 'Energy' && /^(Basic\s+)?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i.test(p.name);
const basicEnergyName = (p) => p.name.replace(/^Basic\s+/i, '');
const textKey = (p) =>
  isBasicEnergy(p)
    ? `energy|${loose(basicEnergyName(p))}`
    : [p.name, p.category, p.stage, p.hp, (p.abilities ?? []).map((a) => a.name).join(','), (p.attacks ?? []).map((a) => `${a.name}${a.damage ?? ''}`).join(','), loose(p.effect).slice(0, 80)].join('|');
const byCard = new Map();
for (const p of expanded) (byCard.get(textKey(p)) ?? byCard.set(textKey(p), []).get(textKey(p))).push(p);

const isAlt = (p) => {
  const n = parseInt(p.localId, 10);
  const official = setById.get(p.set.id)?.cardCount?.official;
  return isNaN(n) || (official ? n > official : false) || /illustration|secret|hyper|shiny|special art|full art/i.test(p.rarity ?? '');
};
const releasedOf = (p) => setById.get(p.set.id)?.releaseDate ?? '';
const ruleBox = (p) => {
  const tags = [];
  if (p.suffix) tags.push(p.suffix);
  if (/ ex$/.test(p.name)) tags.push('ex');
  if (/-EX$/.test(p.name)) tags.push('EX');
  if (/-GX$/.test(p.name) || /GX$/.test(p.name)) tags.push('GX');
  if (/ V$/.test(p.name)) tags.push('V');
  if (/ VMAX$/.test(p.name)) tags.push('VMAX');
  if (/ VSTAR$/.test(p.name)) tags.push('VSTAR');
  return [...new Set(tags)];
};

const cards = [];
let priced = 0;
for (const list of byCard.values()) {
  // Set printings before promos (svp, swshp, …), then oldest first.
  const promo = (p) => /p$/.test(p.set.id) || /promo/i.test(p.rarity ?? '');
  list.sort((a, b) => Number(promo(a)) - Number(promo(b)) || releasedOf(a).localeCompare(releasedOf(b)) || a.id.localeCompare(b.id));
  const standard = list.filter((p) => !isAlt(p));
  const pool = standard.length ? standard : list;
  const main = pool[0];
  const withTcg = pool.map((p) => ({ p, t: tcgOf(p) })).filter((x) => x.t);
  const cheapest = withTcg.sort((a, b) => (a.t.price ?? Infinity) - (b.t.price ?? Infinity))[0];
  if (cheapest?.t.price != null) priced++;
  // Newest standard printing for the regulation mark and the Pokémon TCG Live code.
  const newest = [...pool].sort((a, b) => releasedOf(b).localeCompare(releasedOf(a)))[0];
  const set = setById.get(main.set.id);

  cards.push({
    id: main.id,
    name: isBasicEnergy(main) ? basicEnergyName(main) : main.name,
    basicEnergy: isBasicEnergy(main) || undefined,
    category: main.category,
    stage: main.stage ?? undefined,
    hp: main.hp ?? undefined,
    types: main.types?.length ? main.types : undefined,
    evolveFrom: main.evolveFrom ?? undefined,
    trainerType: main.trainerType ?? undefined,
    energyType: main.energyType ?? undefined,
    mark: newest.regulationMark ?? undefined,
    rarity: main.rarity ?? undefined,
    tags: ruleBox(main).length ? ruleBox(main) : undefined,
    aceSpec: /ACE SPEC/i.test(main.rarity ?? '') || (OLD_ACE_SPECS.includes(main.name) && main.set.id.startsWith('bw')) || undefined,
    radiant: /^Radiant /.test(main.name) || /radiant/i.test(main.rarity ?? '') || undefined,
    prismStar: /◇|Prism Star/i.test(`${main.name} ${main.rarity ?? ''} ${main.suffix ?? ''}`) || undefined,
    // Names and damage only: the full rules text is on the card image, and it would double the file.
    abilities: main.abilities?.length ? main.abilities.map((a) => a.name) : undefined,
    attacks: main.attacks?.length ? main.attacks.map((a) => `${a.name}${a.damage ? ` ${a.damage}` : ''}`) : undefined,
    text: main.category === 'Pokemon' ? undefined : (main.effect ?? undefined),
    weakness: main.weaknesses?.[0] ? `${main.weaknesses[0].type} ${main.weaknesses[0].value}` : undefined,
    retreat: main.retreat ?? undefined,
    set: set?.name ?? main.set.id,
    released: releasedOf(list[0]),
    // Pokémon TCG Live codes ("PAF 7") for every printing, for importing lists.
    codes: [...new Set(list.map((p) => (codeOf(setById.get(p.set.id)) ? `${codeOf(setById.get(p.set.id))} ${p.localId}` : null)).filter(Boolean))],
    code: codeOf(setById.get(newest.set.id)) ? `${codeOf(setById.get(newest.set.id))} ${newest.localId}` : undefined,
    standard: list.some((p) => p.legal?.standard) || undefined,
    img: main.image ? `${main.image}/high.webp` : undefined,
    price: cheapest?.t.price ?? null,
    tcg: cheapest?.t.id,
  });
}
cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), cards }));
const n = (f) => cards.filter(f).length;
console.log(
  `Wrote ${cards.length} cards (${priced} priced, ${n((c) => c.tcg)} on TCGplayer, ${n((c) => c.standard)} Standard-legal, ` +
    `${n((c) => c.aceSpec)} ACE SPEC, ${n((c) => c.radiant)} Radiant, ${n((c) => c.code)} with a Live code)`,
);
