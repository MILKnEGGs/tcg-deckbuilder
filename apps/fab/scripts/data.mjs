// Builds public/data/cards.json for the Flesh and Blood app. Cards, legality and bans for every format,
// and each printing's TCGplayer id come from the open card database at
// github.com/the-fab-cube/flesh-and-blood-cards; prices from TCGCSV (TCGplayer) by that id.
// Run with "npm run data"; the deploy workflow runs it daily.
//
// A card is its name plus pitch color ("Snatch" red), which is what the copy limit counts, so reprints,
// foils and alt arts are the same card. Its price is the cheapest non-foil standard-art printing.

import { mkdirSync, writeFileSync } from 'node:fs';

const SOURCE = 'https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json';
const TCG_CATEGORY = 62; // TCGCSV / TCGplayer category for Flesh and Blood
const OUT = new URL('../public/data/cards.json', import.meta.url);
const HEADERS = { 'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)' };

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

// ---------------------------------------------------------------------------------------------

const source = await getJson(SOURCE);
console.log(`the-fab-cube: ${source.length} cards`);

// TCGplayer market prices by product id, non-foil first.
const prices = new Map();
for (const g of (await getJson(`https://tcgcsv.com/tcgplayer/${TCG_CATEGORY}/groups`)).results) {
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
  if (c.types.some((t) => SKIP_TYPES.has(t))) continue;
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
