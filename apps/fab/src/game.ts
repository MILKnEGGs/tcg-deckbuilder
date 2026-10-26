// Flesh and Blood for the shared deck builder: Classic Constructed, Blitz, Silver Age and Living Legend.
//
// Deck rules (Tournament Rules and Policy section 7): one hero, and a card pool of weapons, equipment
// (arena cards), deck cards and sideboard cards. A "unique card" is a name plus pitch color, so Snatch
// red and Snatch blue are different cards. Every card must share the hero's classes and talents (or be
// Generic); a Specialization card needs that named hero; Legendary cards are 1 per pool.
//
//   Classic Constructed: adult hero, pool of 80 at most, deck of 60 or more, 3 copies
//   Living Legend: as Classic Constructed but retired heroes are legal; restricted cards 1 copy
//   Blitz: young hero, pool of 52 at most, deck of exactly 40, 1 copy
//   Silver Age: young hero, commons and rares only, pool of 55 at most, deck of exactly 40, 2 copies
//
// Which cards are legal, banned or suspended in each format comes with the card data (the-fab-cube).

import { listNamer, taggedCard } from '@milk/core/import';
import { copyIssues, legalityIssues, sizeIssues, unknownCards } from '@milk/core/rules';
import type { Badge, Card, CardIndex, Deck, Entry, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

type FormatId = 'cc' | 'blitz' | 'sa' | 'll';

export interface FabCard extends Card {
  pitch?: number;
  color?: 'Red' | 'Yellow' | 'Blue' | string;
  /** Hero, Weapon, Equipment, Action, Instant, Attack Reaction, Defense Reaction, Block, … */
  kind: string;
  /** Equipment that's also an Action or Instant (Evos): it goes in the deck, not with the arena cards. */
  deckCard?: true;
  typeText: string;
  /** Classes and talents ("Warrior", "Light"). Generic cards have none. */
  supertypes: string[];
  /** Hybrid cards ("Guardian / Warrior"): each half's supertypes; the hero needs to match one. */
  hybrid?: string[][];
  generic?: true;
  young?: true;
  subtypes?: string[];
  cost?: number | string;
  power?: number | string;
  defense?: number | string;
  health?: number;
  intellect?: number;
  arcane?: number | string;
  keywords?: string[];
  legendary?: true;
  /** Hero names this card is a Specialization of. */
  specialization?: string[];
  /** Heroes: talents an "Essence of …" keyword adds. */
  essence?: string[];
  text?: string;
  rarity?: string;
  set: string;
  sets: string[];
  /** The set of the printing the price is for. */
  priceSet?: string;
  /** Why the card can't be played in a format; formats it's fine in are absent. */
  bad: Partial<Record<FormatId, string>>;
  /** Formats where the card is restricted to 1 copy. */
  restricted?: FormatId[];
  img?: string;
  /** The other face of a double-faced card (Singularity flips to Teklovossen, the Mechropotent). */
  back?: { name: string; typeText: string; text?: string; img?: string };
}

interface FabFormat extends FormatDef {
  id: FormatId;
  pool: number;
  copies: number;
}

const zones = () => [
  { id: 'hero', name: 'Hero', max: 1, command: true },
  { id: 'arena', name: 'Weapons & equipment', max: 40 },
  { id: 'main', name: 'Deck', max: 150 },
  { id: 'side', name: 'Sideboard', max: 60 },
];

export const formats: FabFormat[] = [
  {
    id: 'cc',
    name: 'Classic Constructed',
    summary: 'An adult hero, 60 or more cards in the deck, up to 80 cards in the pool with equipment and sideboard, 3 of each',
    zones: zones(),
    size: { zones: ['main'], target: 60 },
    pool: 80,
    copies: 3,
  },
  {
    id: 'blitz',
    name: 'Blitz',
    summary: 'A young hero, exactly 40 cards in the deck, up to 52 in the pool, 1 of each',
    zones: zones(),
    size: { zones: ['main'], target: 40, exact: true },
    pool: 52,
    copies: 1,
  },
  {
    id: 'sa',
    name: 'Silver Age',
    summary: 'A young hero and only common or rare cards, exactly 40 in the deck, up to 55 in the pool, 2 of each',
    zones: zones(),
    size: { zones: ['main'], target: 40, exact: true },
    pool: 55,
    copies: 2,
  },
  {
    id: 'll',
    name: 'Living Legend',
    summary: 'Classic Constructed rules with retired heroes allowed and its own banned and restricted list',
    zones: zones(),
    size: { zones: ['main'], target: 60 },
    pool: 80,
    copies: 3,
  },
];
const fmt = (f: FormatDef) => f as FabFormat;

export function illegal(card: FabCard, format: FormatDef): string | null {
  const why = card.bad[fmt(format).id];
  if (!why) return null;
  if (why === 'not legal' && card.kind === 'Hero') return card.young ? `young heroes aren't played in ${format.name}` : `adult heroes aren't played in ${format.name}`;
  return why === 'not legal' ? `not legal in ${format.name}` : `${why} in ${format.name}`;
}

export function maxCopies(card: FabCard, format: FormatDef): number {
  if (card.kind === 'Hero' || card.legendary || card.restricted?.includes(fmt(format).id)) return 1;
  return fmt(format).copies;
}

// ---------------------------------------------------------------------------------------------
// Hero fit

const rows = (deck: Deck, cards: CardIndex<FabCard>, zoneIds = Object.keys(deck.zones)) =>
  zoneIds.flatMap((z) => (deck.zones[z] ?? []).map((e) => ({ z, e, c: cards.get(e.id) }))).filter((x): x is { z: string; e: Entry; c: FabCard } => !!x.c);

export const heroOf = (deck: Deck, cards: CardIndex<FabCard>) => rows(deck, cards, ['hero'])[0]?.c;

/** Why the card can't go with this hero, or null if it can. */
export function heroMiss(card: FabCard, hero: FabCard | undefined): string | null {
  if (!hero || card.kind === 'Hero') return null;
  const has = new Set([...hero.supertypes, ...(hero.essence ?? [])]);
  if (card.hybrid) {
    if (!card.hybrid.some((half) => half.every((t) => has.has(t)))) return `Not ${card.hybrid.map((half) => half.join(' ')).join(' or ')}`;
  } else {
    const missing = card.supertypes.filter((t) => !has.has(t));
    if (missing.length) return `Not ${missing.join(' ')}`;
  }
  if (card.specialization && !card.specialization.some((h) => hero.name === h || hero.name.startsWith(`${h} `) || hero.name.startsWith(`${h},`)))
    return `${card.specialization.join(' or ')} only`;
  return null;
}

function validate(deck: Deck, cards: CardIndex<FabCard>, format: FormatDef): Issue[] {
  const f = fmt(format);
  const issues: Issue[] = [...sizeIssues(deck, format)];
  const all = rows(deck, cards);
  const heroes = all.filter((x) => x.z === 'hero');
  const hero = heroes[0]?.c;
  if (!heroes.length) issues.push({ level: 'error', message: 'Choose a hero' });

  const pool = all.filter((x) => x.z !== 'hero').reduce((n, x) => n + x.e.qty, 0);
  if (pool > f.pool) issues.push({ level: 'error', message: `Card pool is ${pool} cards (weapons, equipment, deck and sideboard); ${format.name} allows ${f.pool}` });
  issues.push(...copyIssues(game, deck, cards, format));

  // Cards that don't suit the hero, grouped by reason.
  const misses = new Map<string, string[]>();
  for (const { c } of all) {
    const why = heroMiss(c, hero);
    if (why) (misses.get(why) ?? misses.set(why, []).get(why)!).push(c.id);
  }
  for (const [why, ids] of misses)
    issues.push({ level: 'error', message: `${why} (hero is ${hero!.name}): ${[...new Set(ids)].map((id) => label(cards.get(id)!)).join(', ')}`, cards: ids });

  const wrongZone = all.filter((x) => x.z !== 'hero' && (x.z === 'arena') !== isArena(x.c));
  if (wrongZone.length)
    issues.push({ level: 'warning', message: `In the wrong section: ${wrongZone.map((x) => label(x.c)).join(', ')}`, cards: wrongZone.map((x) => x.c.id) });

  if (hero && !all.some((x) => x.z === 'arena' && x.c.kind === 'Weapon')) issues.push({ level: 'warning', message: 'No weapon yet' });
  return [...issues, ...legalityIssues(game, deck, cards, format), ...unknownCards(deck, cards)];
}

// ---------------------------------------------------------------------------------------------
// Decklists, as Fabrary writes them:
//   Name: Dorinthea Aggro
//   Hero: Dorinthea Ironsong
//   Format: Classic Constructed
//
//   Arena cards
//   1x Dawnblade
//
//   Deck cards
//   3x Snatch (red)

const COLOR_WORD: Record<string, string> = { Red: 'red', Yellow: 'yellow', Blue: 'blue' };
const label = (c: FabCard) => (c.color && COLOR_WORD[c.color] ? `${c.name} (${COLOR_WORD[c.color]})` : c.name);
const isArena = (c: FabCard) => (c.kind === 'Weapon' || c.kind === 'Equipment') && !c.deckCard;
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

function exportDeck(deck: Deck, cards: CardIndex<FabCard>): string {
  const name = listNamer(cards, label);
  const lines = (zone: string) => rows(deck, cards, [zone]).map((x) => `${x.e.qty}x ${name(x.c)}`);
  const hero = heroOf(deck, cards);
  const format = formats.find((f) => f.id === deck.format);
  const out = [`Name: ${deck.name}`, ...(hero ? [`Hero: ${hero.name}`] : []), ...(format ? [`Format: ${format.name}`] : []), ''];
  for (const [title, zone] of [['Arena cards', 'arena'], ['Deck cards', 'main'], ['Sideboard', 'side']] as const) {
    const l = lines(zone);
    if (l.length) out.push(title, ...l, '');
  }
  return out.join('\n').trim();
}

function importDeck(text: string, cards: CardIndex<FabCard>): Imported {
  const all = [...new Set(cards.values())];
  const byLabel = new Map<string, FabCard>();
  for (const c of all) byLabel.set(norm(label(c)), c);
  // A colorless name, or a name given without its color: prefer red, then yellow, then blue.
  const byName = new Map<string, FabCard>();
  for (const c of [...all].sort((a, b) => (b.pitch ?? 0) - (a.pitch ?? 0))) byName.set(norm(c.name), c);
  const zones: Record<string, Entry[]> = { hero: [], arena: [], main: [], side: [] };
  const skipped: string[] = [];
  let name: string | undefined;
  let format: string | undefined;
  let side = false;
  const add = (c: FabCard, qty: number, zone: string) => {
    const e = zones[zone].find((x) => x.id === c.id);
    if (e) e.qty += qty;
    else zones[zone].push({ id: c.id, qty, owned: 0 });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const kv = /^(name|hero|format|deck build|made with)[^:]*:\s*(.*)$/i.exec(line);
    if (kv) {
      const key = kv[1].toLowerCase();
      if (key === 'name') name = kv[2];
      else if (key === 'format') format = formats.find((f) => norm(f.name) === norm(kv[2]) || f.id === norm(kv[2]))?.id ?? (/blitz/i.test(kv[2]) ? 'blitz' : /silver/i.test(kv[2]) ? 'sa' : /legend/i.test(kv[2]) ? 'll' : 'cc');
      else if (key === 'hero') {
        const h = byName.get(norm(kv[2]));
        if (h) add(h, 1, 'hero');
        else skipped.push(line);
      }
      continue;
    }
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
    if (!m) {
      side = /sideboard|side board/i.test(line); // a heading ("Arena cards", "Deck cards", "Sideboard")
      continue;
    }
    const want = norm(m[2]);
    const card = taggedCard(raw, cards) ?? byLabel.get(want) ?? byName.get(want.replace(/\s*\((red|yellow|blue)\)$/, ''));
    if (!card) {
      skipped.push(line);
      continue;
    }
    add(card, Number(m[1]), card.kind === 'Hero' ? 'hero' : isArena(card) ? 'arena' : side ? 'side' : 'main');
  }
  if (!Object.values(zones).some((z) => z.length)) throw new Error('No cards recognised in that list');
  if (!format) {
    const hero = zones.hero[0] && cards.get(zones.hero[0].id);
    format = hero?.young ? 'blitz' : 'cc';
  }
  return { name, format, zones, skipped };
}

// ---------------------------------------------------------------------------------------------

const PITCH_STYLE: Record<number, { text: string; color: string; name: string }> = {
  1: { text: '1', color: '#ef4444', name: 'Red' },
  2: { text: '2', color: '#eab308', name: 'Yellow' },
  3: { text: '3', color: '#3b82f6', name: 'Blue' },
};
const group = (c: FabCard) =>
  c.deckCard ? (c.subtypes?.some((s) => s.startsWith('Evo')) ? 'Evos' : 'Deck equipment') : c.kind === 'Action' ? (c.subtypes?.includes('Attack') ? 'Attack actions' : 'Non-attack actions') : c.kind === 'Weapon' ? 'Weapons' : c.kind === 'Equipment' ? 'Equipment' : c.kind === 'Hero' ? 'Hero' : c.kind === 'Ally' ? 'Allies' : `${c.kind}s`;
const numOrNull = (v: number | string | undefined) => (typeof v === 'number' ? v : null);

export const game: GameDef<FabCard> = {
  id: 'fab',
  title: "Milk's Flesh and Blood Deck Builder",
  game: 'Flesh and Blood',
  formats,
  zoneFor: (c) => (c.kind === 'Hero' ? 'hero' : isArena(c) ? 'arena' : 'main'),
  maxCopies,
  illegal: (c, f) => illegal(c, f),
  validate,

  label,
  setCode: (c) => c.priceSet ?? c.set,
  group,
  groups: ['Weapons', 'Equipment', 'Attack actions', 'Non-attack actions', 'Evos', 'Deck equipment', 'Attack Reactions', 'Defense Reactions', 'Instants', 'Blocks', 'Allies', 'Mentors', 'Resources'],
  cost: (c) => (isArena(c) || c.kind === 'Hero' ? null : numOrNull(c.cost)),
  // Within each group: red, yellow, blue (colourless first), then name.
  deckOrder: (a, b) => (a.pitch ?? 0) - (b.pitch ?? 0) || a.name.localeCompare(b.name),
  image: (c) => ({ src: c.img ?? '', back: c.back?.img }),
  meters: (deck, cards, format) => [
    { label: 'card pool', value: rows(deck, cards).filter((x) => x.z !== 'hero').reduce((n, x) => n + x.e.qty, 0), max: fmt(format).pool },
  ],
  badges: (c): Badge[] => [
    ...(c.pitch && PITCH_STYLE[c.pitch] ? [{ text: PITCH_STYLE[c.pitch].text, title: `Pitch ${c.pitch} (${PITCH_STYLE[c.pitch].name})`, color: PITCH_STYLE[c.pitch].color }] : []),
    ...(c.legendary ? [{ text: 'L', title: 'Legendary (1 per pool)', color: '#f59e0b', square: true }] : []),
    ...(c.specialization ? [{ text: '★', title: `${c.specialization.join(' or ')} Specialization`, color: '#e11d48', square: true }] : []),
  ],
  details: (c) => {
    const rows: [string, string][] = [['Type', c.typeText]];
    if (c.kind === 'Hero') {
      if (c.health != null) rows.push(['Life', String(c.health)]);
      if (c.intellect != null) rows.push(['Intellect', String(c.intellect)]);
    } else {
      if (c.pitch) rows.push(['Pitch', `${c.pitch} (${PITCH_STYLE[c.pitch]?.name ?? c.color})`]);
      if (c.cost != null) rows.push(['Cost', String(c.cost)]);
      if (c.power != null) rows.push(['Power', String(c.power)]);
      if (c.defense != null) rows.push(['Defense', String(c.defense)]);
      if (c.arcane != null) rows.push(['Arcane', String(c.arcane)]);
    }
    if (c.keywords) rows.push(['Keywords', c.keywords.join(', ')]);
    if (c.specialization) rows.push(['Specialization', `${c.specialization.join(' or ')} only`]);
    rows.push(['Rarity', c.rarity ?? '—']);
    rows.push(['Sets', c.sets.join(', ')]);
    const legal = formats.map((f) => `${f.name}: ${c.bad[f.id] ?? (c.restricted?.includes(f.id) ? 'restricted (1)' : 'legal')}`);
    rows.push(['Legality', legal.join(' · ')]);
    if (c.back) rows.push(['Other side', `${c.back.name} (${c.back.typeText})`]);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => [...(c.text ? c.text.split('\n') : []), ...(c.back?.text ? [`Other side (${c.back.name}): ${c.back.text}`] : [])],
  searchText: (c) =>
    [c.name, c.color, c.typeText, ...(c.keywords ?? []), c.text, ...c.sets, c.back?.name, c.back?.typeText, c.back?.text].filter(Boolean).join(' ').toLowerCase(),
  filters: [
    { id: 'kind', label: 'Type', values: (c) => [group(c)], options: ['Hero', 'Weapons', 'Equipment', 'Attack actions', 'Non-attack actions', 'Evos', 'Attack Reactions', 'Defense Reactions', 'Instants', 'Blocks', 'Allies', 'Mentors', 'Resources'] },
    { id: 'pitch', label: 'Pitch', values: (c) => (c.pitch ? [`${c.pitch} ${PITCH_STYLE[c.pitch]?.name ?? ''}`.trim()] : []), options: ['1 Red', '2 Yellow', '3 Blue'] },
    { id: 'class', label: 'Class', values: (c) => (c.supertypes.length ? c.supertypes : ['Generic']) },
    { id: 'cost', label: 'Cost', values: (c) => (c.cost != null ? [String(c.cost)] : []) },
    { id: 'slot', label: 'Slot', values: (c) => (c.kind === 'Equipment' || c.kind === 'Weapon' ? (c.subtypes ?? []).filter((s) => !/[()]/.test(s)) : []) },
    { id: 'rarity', label: 'Rarity', values: (c) => (c.rarity ? [c.rarity] : []) },
    { id: 'set', label: 'Set', values: (c) => c.sets },
  ],
  stats: ['pitch', 'kind'],
  fit: {
    label: 'Fits my hero',
    miss: (c, deck, cards) => heroMiss(c, heroOf(deck, cards)),
    test: (c, deck, cards) => !heroMiss(c, heroOf(deck, cards)),
    // A hero's pool can only hold cards that suit it (Comprehensive Rules 1.1.3).
    auto: (deck, cards) => !!heroOf(deck, cards),
  },

  goldfish: {
    hand: 4,
    handFrom: (deck, cards) => heroOf(deck, cards)?.intellect ?? 4,
    refill: true,
    mulligans: 0,
    draw: 0,
    turn: 'Turn',
    zones: ['main'],
    resources: { setup: 0, perTurn: 99, firstTurn: true, action: 'Pitch', pile: 'Pitched' },
    counter: { name: 'Life', first: 40, perTurn: 0, max: 0, firstFrom: (deck, cards) => heroOf(deck, cards)?.health ?? 40 },
    note: "Your hand is your hero's intellect, and you draw back up to it at the end of each turn. Pitch cards to pay costs (red 1, yellow 2, blue 3), and use Life − / + to track damage.",
    odds: [
      { label: 'Red (pitch 1)', test: (c) => c.pitch === 1 },
      { label: 'Blue (pitch 3)', test: (c) => c.pitch === 3 },
      { label: 'Attack action', test: (c) => c.kind === 'Action' && !!c.subtypes?.includes('Attack') },
      { label: 'Defense Reaction', test: (c) => c.kind === 'Defense Reaction' },
    ],
  },

  importHint: 'Paste a Fabrary text list ("Hero: …", then "3x Snatch (red)" per line under Arena cards / Deck cards / Sideboard).',
  exportLabel: 'Copy decklist (Fabrary text)',
  exportDeck,
  importDeck,
  tcgProductLine: 'Flesh and Blood TCG',
  massEntryById: true,
};
