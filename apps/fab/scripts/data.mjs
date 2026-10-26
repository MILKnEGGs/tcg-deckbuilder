// Builds public/data/cards.json for the Flesh and Blood app. Cards, legality and bans for every format,
// and each printing's TCGplayer id come from the open card database at
// github.com/the-fab-cube/flesh-and-blood-cards; prices from TCGCSV (TCGplayer) by that id.
// Run with "npm run data"; the deploy workflow runs it daily.
//
// New sets are added on a branch of that repo (named after the set) and merged weeks after release, so
// this also reads every other branch: cards and printings it adds are kept once their set is out, and
// previews of unreleased sets are left out. Where a card is on both, develop's text (errata) wins.
//
// A card is its name plus pitch color ("Snatch" red), which is what the copy limit counts, so reprints,
// foils and alt arts are the same card. Its price is the cheapest non-foil standard-art printing.

import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = 'the-fab-cube/flesh-and-blood-cards';
const raw = (branch, file) => `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(branch)}/json/english/${file}`;
const TCG_CATEGORY = 62; // TCGCSV / TCGplayer category for Flesh and Blood
const OUT = new URL('../public/data/cards.json', import.meta.url);
const HEADERS = { 'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)' };
// The deploy workflow passes its token so listing branches isn't rate-limited.
const GITHUB_HEADERS = { ...HEADERS, ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

/** Classes and talents: a card can only go with a hero that has all of the card's. */
const SUPERTYPES = new Set([
  'Adjudicator', 'Assassin', 'Bard', 'Brute', 'Guardian', 'Illusionist', 'Mechanologist', 'Merchant', 'Necromancer', 'Ninja',
  'Pirate', 'Ranger', 'Runeblade', 'Shapeshifter', 'Thief', 'Warrior', 'Wizard',
  'Chaos', 'Draconic', 'Earth', 'Elemental', 'Ice', 'Light', 'Lightning', 'Mystic', 'Revered', 'Reviled', 'Royal', 'Shadow',
]);
/** Not part of a card pool. */
const SKIP_TYPES = new Set(['Token', 'Demi-Hero', 'Macro', 'Placeholder Card']);
const CARD_TYPES = ['Hero', 'Weapon', 'Equipment', 'Action', 'Attack Reaction', 'Defense Reaction', 'Instant', 'Block', 'Resource', 'Mentor', 'Ally', 'Event'];
const RARITY = { B: 'Basic', T: 'Token', C: 'Common', R: 'Rare', S: 'Super Rare', M: 'Majestic', L: 'Legendary', F: 'Fabled', P: 'Promo', V: 'Marvel' };
const RARITY_ORDER = 'BCRSMLFPVT';

async function getJson(url, headers = HEADERS) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// ---------------------------------------------------------------------------------------------

const source = await getJson(raw('develop', 'card.json'));
console.log(`the-fab-cube: ${source.length} cards on develop`);

// Release dates by set, from every branch's set list. A set only known from a branch counts as out once
// its date has passed; one without a date is a preview.
let branches = [];
try {
  branches = (await getJson(`https://api.github.com/repos/${REPO}/branches?per_page=100`, GITHUB_HEADERS)).map((b) => b.name).filter((b) => b !== 'develop' && b !== 'main');
} catch (err) {
  console.warn(`  couldn't list branches, using develop only: ${err.message}`);
}
const released = new Map(); // set id -> earliest release date ('' when unknown)
const addSets = (list, fromDevelop) => {
  for (const s of list) {
    const date = (s.printings ?? []).map((p) => p.initial_release_date).filter(Boolean).sort()[0] ?? '';
    if (!released.has(s.id) || (date && date < released.get(s.id))) released.set(s.id, fromDevelop && !date ? '0' : date);
  }
};
addSets(await getJson(raw('develop', 'set.json')), true);
const today = new Date().toISOString();
const isOut = (setId) => {
  const d = released.get(setId);
  return d != null && d !== '' && d <= today;
};

const byId = new Map(source.map((c) => [c.unique_id, c]));
for (const branch of branches) {
  try {
    addSets(await getJson(raw(branch, 'set.json')), false);
    let cards = 0;
    let prints = 0;
    for (const c of await getJson(raw(branch, 'card.json'))) {
      const fresh = c.printings.filter((p) => isOut(p.set_id));
      const known = byId.get(c.unique_id);
      if (!known) {
        if (fresh.length) {
          byId.set(c.unique_id, { ...c, printings: fresh });
          source.push(byId.get(c.unique_id));
          cards++;
        }
        continue;
      }
      const have = new Set(known.printings.map((p) => p.unique_id));
      const extra = fresh.filter((p) => !have.has(p.unique_id));
      known.printings.push(...extra);
      prints += extra.length;
    }
    console.log(`  branch ${branch}: ${cards} released cards and ${prints} printings not on develop yet`);
  } catch (err) {
    console.warn(`  skipped branch ${branch}: ${err.message}`);
  }
}
// Develop also lists products a few weeks before they come out; leave those printings out until then.
for (const c of source) c.printings = c.printings.filter((p) => !(released.get(p.set_id) > today));

// TCGplayer market prices by product id, non-foil first.
const prices = new Map();
const groups = (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results;
// New sets often reach the card data before their TCGplayer ids do (Armory Deck: Malice did). For those
// printings, find the product in that set's TCGplayer listing by card number ("AMA005").
const missing = new Set(source.flatMap((c) => c.printings.filter((p) => !p.tcgplayer_product_id).map((p) => p.set_id)));
const filled = new Map(); // set id -> printings matched
const simple = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const sameName = (product, card) => !!product && simple(product).startsWith(simple(card));
for (const g of groups.filter((g) => g.abbreviation && missing.has(g.abbreviation))) {
  try {
    const byNumber = new Map();
    for (const p of (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/products`)).results) {
      const number = p.extendedData?.find((e) => e.name === 'Number')?.value;
      if (number && !byNumber.has(number)) byNumber.set(number, p);
    }
    for (const c of source)
      for (const p of c.printings)
        // Only when the product really is this card (its name starts with the card name).
        if (p.set_id === g.abbreviation && !p.tcgplayer_product_id && sameName(byNumber.get(p.id)?.name, c.name)) {
          p.tcgplayer_product_id = String(byNumber.get(p.id).productId);
          filled.set(g.abbreviation, (filled.get(g.abbreviation) ?? 0) + 1);
        }
  } catch (err) {
    console.warn(`  no products for ${g.name}: ${err.message}`);
  }
}
if (filled.size) console.log(`TCGCSV: matched printings without a TCGplayer id by card number: ${[...filled].map(([s, n]) => `${s} ${n}`).join(", ")}`);
for (const g of groups) {
  try {
    for (const p of (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/${g.groupId}/prices`)).results) {
      const v = p.marketPrice ?? p.midPrice ?? p.lowPrice;
      if (v == null) continue;
      const normal = /normal|unlimited|1st edition$/i.test(p.subTypeName) && !/foil/i.test(p.subTypeName);
      const old = prices.get(p.productId);
      if (!old || (normal && (!old.normal || v < old.v))) prices.set(p.productId, { v, normal });
    }
  } catch (err) {
    console.warn(`  no prices for ${g.name}: ${err.message}`);
  }
}
console.log(`TCGCSV: ${prices.size} Flesh and Blood prices`);

const num = (s) => (s === '' || s == null ? null : /^\d+$/.test(s) ? Number(s) : s);
/** Why a card can't be played in a format, or undefined when it can. */
function status(c, f) {
  if (c[`${f}_banned`]) return 'banned';
  if (c[`${f}_suspended`]) return 'suspended';
  if (c[`${f}_living_legend`]) return 'living legend';
  if (!c[`${f}_legal`]) return 'not legal';
  return undefined;
}

const cards = [];
for (const c of source) {
  if (!c.printings.length || c.types.some((t) => SKIP_TYPES.has(t))) continue;
  const bad = {
    cc: status(c, 'cc'),
    blitz: status(c, 'blitz'),
    sa: status({ ...c, sa_legal: c.silver_age_legal, sa_banned: c.silver_age_banned }, 'sa'),
    ll: status(c, 'll'),
  };
  if (Object.values(bad).every((v) => v === 'not legal')) continue; // never tournament legal (promos for other games, etc.)

  const all = c.printings;
  const plain = all.filter((p) => !p.art_variations?.length && p.foiling === 'S');
  const pool = plain.length ? plain : all.filter((p) => !p.art_variations?.length).length ? all.filter((p) => !p.art_variations?.length) : all;
  const priceOf = (p) => (p.tcgplayer_product_id ? prices.get(Number(p.tcgplayer_product_id))?.v : undefined) ?? null;
  const cheapest = [...pool].filter((p) => p.tcgplayer_product_id && priceOf(p) != null).sort((a, b) => priceOf(a) - priceOf(b))[0];
  // Picture: the newest plain printing (better scans), falling back to anything with an image.
  const pic = [...pool].reverse().find((p) => p.image_url) ?? all.find((p) => p.image_url);
  const rarities = [...new Set(all.map((p) => p.rarity))].sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
  const kind = CARD_TYPES.find((t) => c.types.includes(t) || c.type_text.includes(t)) ?? (c.types.includes('Aura') || c.types.includes('Item') ? 'Action' : 'Other');
  const keywords = c.card_keywords;
  const spec = keywords.find((k) => k.endsWith(' Specialization'));
  const essence = keywords.find((k) => k.startsWith('Essence of '));

  bad.sa ??= undefined;
  cards.push({
    id: c.unique_id,
    name: c.name,
    pitch: num(c.pitch) ?? undefined,
    color: c.color || undefined,
    kind,
    typeText: c.type_text,
    supertypes: c.types.filter((t) => SUPERTYPES.has(t)),
    // "Guardian / Warrior": either half suits the hero (Comprehensive Rules 1.1.3b).
    hybrid: c.type_text.split(/ [-–] /)[0].includes(' / ') ? c.type_text.split(/ [-–] /)[0].split(' / ').map((s) => s.split(/\s+/).filter((w) => SUPERTYPES.has(w))) : undefined,
    generic: c.types.includes('Generic') || undefined,
    young: c.types.includes('Young') || undefined,
    subtypes: c.type_text.split(/ [-–] /)[1]?.split(/\s+/).filter(Boolean),
    cost: num(c.cost) ?? undefined,
    power: num(c.power) ?? undefined,
    defense: num(c.defense) ?? undefined,
    health: num(c.health) ?? undefined,
    intellect: num(c.intelligence) ?? undefined,
    arcane: num(c.arcane) ?? undefined,
    keywords: keywords.length ? keywords : undefined,
    legendary: keywords.includes('Legendary') || undefined,
    specialization: spec ? spec.replace(/ Specialization$/, '').split(' or ') : undefined,
    essence: essence ? essence.replace(/^Essence of /, '').split(' and ') : undefined,
    text: c.functional_text_plain?.replace(/\r/g, '').trim() || undefined,
    rarity: RARITY[rarities.find((r) => r !== 'P' && r !== 'V' && r !== 'T') ?? rarities[0]] ?? undefined,
    set: pool[0].set_id,
    sets: [...new Set(all.map((p) => p.set_id))],
    bad: Object.fromEntries(Object.entries(bad).filter(([, v]) => v)),
    restricted: c.ll_restricted ? ['ll'] : undefined,
    img: pic?.image_url,
    price: cheapest ? priceOf(cheapest) : null,
    tcg: cheapest ? Number(cheapest.tcgplayer_product_id) : pool.find((p) => p.tcgplayer_product_id) ? Number(pool.find((p) => p.tcgplayer_product_id).tcgplayer_product_id) : undefined,
  });
}
cards.sort((a, b) => a.name.localeCompare(b.name) || (a.pitch ?? 0) - (b.pitch ?? 0));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), cards }));
const n = (f) => cards.filter(f).length;
console.log(
  `Wrote ${cards.length} cards (${n((c) => c.price != null)} priced, ${n((c) => c.kind === 'Hero')} heroes, ` +
    `${n((c) => !c.bad.cc)} CC-legal, ${n((c) => !c.bad.blitz)} Blitz-legal, ${n((c) => !c.bad.sa)} Silver Age-legal)`,
);
