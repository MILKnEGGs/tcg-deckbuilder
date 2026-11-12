// Trims DeckPlanet's Alpha Clash export (a one-off file DeckPlanet's makers sent us to use) down to what the
// builder needs, into data/deckplanet.json, which data.mjs reads on every run. TCGplayer stays the main
// source (it has new sets first, plus images and prices); DeckPlanet fixes names, adds Contender health,
// errata and two-sided Contenders. To refresh after DeckPlanet sends a newer export:
//   node scripts/deckplanet.mjs path/to/alpha_clash_all.json
// Its role field (Destroyer, Savior, Sentinel) is empty, so decks still pick their Contender's role.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = process.argv[2];
if (!src) throw new Error('Usage: node scripts/deckplanet.mjs <DeckPlanet export .json>');
const OUT = new URL('../data/deckplanet.json', import.meta.url);

const strip = (s) =>
  s
    ?.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '\n- ')
    // Symbols are pictures: "/assets/img/alpha_clash/alpha_hunter_symbol.webp" -> "(Alpha Hunter symbol)".
    .replace(/<img[^>]*src="[^"]*\/([^"/]+)\.\w+"[^>]*>/gi, (_, f) =>
      `(${f.replace(/_symbol$/i, '').split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')}${/_symbol$/i.test(f) ? ' symbol' : ''})`,
    )
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{([^}]*)\}\}/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim() || undefined;
const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? undefined : Number(v));

const cards = [];
for (const c of JSON.parse(readFileSync(src, 'utf8'))) {
  // "AC1-001_AA": alt arts of a card listed under its own number.
  if (!c.card_name || !c.card_number || c.card_number.includes('_') || c.card_type === 'Token') continue;
  const card = {
    number: c.card_number.toUpperCase(),
    name: c.card_name.trim().replace(/\s+/g, ' '),
    type: c.card_type ?? undefined,
    health: num(c.card_health),
    errata: c.has_errata ? strip(c.errata_text) : undefined,
  };
  if (c.card_back_name)
    Object.assign(card, {
      backName: c.card_back_name.trim(),
      backNumber: c.card_back_number?.toUpperCase(),
      backHealth: num(c.card_back_health),
    });
  cards.push(Object.fromEntries(Object.entries(card).filter(([, v]) => v !== undefined)));
}
cards.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(cards, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`Wrote ${cards.length} DeckPlanet printings (${cards.filter((c) => c.health != null).length} with health, ${cards.filter((c) => c.errata).length} with errata)`);
