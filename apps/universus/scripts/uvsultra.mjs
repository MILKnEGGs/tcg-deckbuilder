// What TCGplayer doesn't tell us about UniVersus symbols, from UVS Ultra (uvsultra.online), a fan-run card
// database: which symbols are attuned (square icons), and the symbols of the one set TCGplayer left blank.
//
// It's someone's hobby site, so we ask little of it: about 50 searches, at most once a week. The deploy
// workflow keeps the result between runs (see .github/workflows/deploy.yml), and a copy is committed in
// uvsultra.json as a fallback if the site is ever down.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const URL_ = 'https://uvsultra.online/listing_cards.php';
const HEADERS = {
  'User-Agent': 'milks-deckbuilder/0.1 (+https://github.com/MILKnEGGs/tcg-deckbuilder)',
  'Content-Type': 'application/x-www-form-urlencoded',
};
const SYMBOLS = ['air', 'all', 'chaos', 'death', 'earth', 'evil', 'fire', 'good', 'infinity', 'life', 'order', 'void', 'water'];
/** UVS Ultra set ids for sets whose symbols TCGplayer is missing. */
const FILL_SETS = { 105: 'My Hero Academia: Undaunted Raid' };
const MAX_AGE_DAYS = 7;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

/** One results page -> [{ name, symbols, attuned }] plus the total result count. */
function parse(html) {
  const total = Number(/(\d+) Results/.exec(html)?.[1] ?? 0);
  const cards = [];
  for (const block of html.split('<div class="card ').slice(1)) {
    const name = /<h1>([\s\S]*?)<\/h1>/.exec(block)?.[1];
    if (!name) continue;
    const icons = [...block.matchAll(/images\/icons\/(at_)?([a-z]+)\.png[^>]*alt="/g)].filter((m) => SYMBOLS.includes(m[2]));
    cards.push({
      name: decode(name.replace(/<[^>]+>/g, '')),
      symbols: icons.map((m) => cap(m[2])),
      attuned: icons.filter((m) => m[1]).map((m) => cap(m[2])),
    });
  }
  return { total, cards };
}

async function search(form) {
  const all = [];
  for (let page = 0; ; page++) {
    const body = `${form}&difficulty_operand=%3D&page=${page}`;
    const res = await fetch(URL_, { method: 'POST', headers: HEADERS, body });
    if (!res.ok) throw new Error(`UVS Ultra ${res.status}`);
    const { total, cards } = parse(await res.text());
    all.push(...cards);
    if (!cards.length || all.length >= total || page > 60) break;
    await new Promise((r) => setTimeout(r, 400)); // gentle
  }
  return all;
}

async function download() {
  const attuned = {}; // card name -> attuned symbols
  for (const s of SYMBOLS) {
    for (const c of await search(`atrs%5B%5D=${s}`)) attuned[c.name] = [...new Set([...(attuned[c.name] ?? []), ...c.attuned])];
  }
  const symbols = {}; // card name -> symbols, for sets TCGplayer left blank
  for (const id of Object.keys(FILL_SETS)) for (const c of await search(`extension%5B%5D=${id}`)) symbols[c.name] = c.symbols;
  return { fetched: new Date().toISOString(), attuned, symbols };
}

/** The attuned/symbol data: the cached copy if it's under a week old, otherwise a fresh download. */
export async function uvsUltra(cacheFile) {
  const cached = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
  const age = cached ? (Date.now() - Date.parse(cached.fetched)) / 86400000 : Infinity;
  if (cached && age < MAX_AGE_DAYS) return cached;
  try {
    const fresh = await download();
    // Sanity check: a broken page layout would otherwise silently drop every attuned card.
    if (Object.keys(fresh.attuned).length < 100) throw new Error(`only ${Object.keys(fresh.attuned).length} attuned cards found`);
    writeFileSync(cacheFile, JSON.stringify(fresh, null, 1));
    return fresh;
  } catch (err) {
    if (!cached) throw err;
    console.warn(`  UVS Ultra unavailable (${err.message}); using data from ${cached.fetched.slice(0, 10)}`);
    return cached;
  }
}
