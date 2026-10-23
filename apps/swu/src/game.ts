// Star Wars: Unlimited for the shared deck builder: card shape, formats, deck rules and display.

import { parseTextDeck } from '@milk/core/import';
import { copyIssues, exactZone, misplaced, sizeIssues, unknownCards, zoneLimit } from '@milk/core/rules';
import type { Card, CardIndex, Deck, Entry, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

export interface SwuCard extends Card {
  sub?: string;
  type: 'Leader' | 'Base' | 'Unit' | 'Event' | 'Upgrade' | string;
  /** Aspect icons, repeated when a card has two of the same (e.g. Command, Command). */
  aspects: string[];
  traits: string[];
  arenas: string[];
  keywords?: string[];
  cost: number | null;
  power: number | null;
  hp: number | null;
  text?: string;
  epic?: string;
  /** A leader's deployed side. */
  back?: string;
  unique: boolean;
  rarity: string;
  set: string;
  /** Image path on cdn.swu-db.com, e.g. "SOR/059". */
  img?: string;
  backImg?: string;
}

const command = (id: string, name: string, max: number) => ({ id, name, max, command: true });

export const formats: FormatDef[] = [
  {
    id: 'order66',
    name: 'Order 66',
    summary: '2 leaders + 1 base + 63 cards = 66. Units 1 copy, events and upgrades up to 3',
    zones: [command('leader', 'Leaders', 2), command('base', 'Base', 1), { id: 'main', name: 'Deck', max: 147 }],
    size: { zones: ['leader', 'base', 'main'], target: 66, exact: true },
  },
  {
    id: 'twinsuns',
    name: 'Twin Suns',
    summary: '2 leaders, 1 base, 80+ cards, 1 copy of each',
    zones: [command('leader', 'Leaders', 2), command('base', 'Base', 1), { id: 'main', name: 'Deck', max: 130 }],
    size: { zones: ['main'], target: 80 },
  },
  {
    id: 'premier',
    name: 'Premier',
    summary: '1 leader, 1 base, 50+ cards, up to 3 copies, 10-card sideboard',
    zones: [
      command('leader', 'Leader', 1),
      command('base', 'Base', 1),
      { id: 'main', name: 'Deck', max: 100 },
      { id: 'side', name: 'Sideboard', max: 25 },
    ],
    size: { zones: ['main'], target: 50 },
  },
];

const label = (c: SwuCard) => (c.sub ? `${c.name}, ${c.sub}` : c.name);
const isDeckCard = (c: SwuCard) => c.type !== 'Leader' && c.type !== 'Base';

function maxCopies(card: SwuCard, format: FormatDef): number {
  if (!isDeckCard(card)) return 1;
  switch (format.id) {
    case 'twinsuns':
      return 1;
    case 'order66':
      return card.type === 'Unit' ? 1 : 3;
    default:
      return 3;
  }
}

/** Twin Suns and Order 66: both leaders must share Heroism, or both Villainy. */
function leaderSides(leaders: SwuCard[]): Issue[] {
  if (leaders.length !== 2) return [];
  const [a, b] = leaders;
  if (a.id === b.id) return [{ level: 'error', message: 'Your two leaders must be different', cards: [a.id] }];
  for (const side of ['Heroism', 'Villainy']) if (a.aspects.includes(side) && b.aspects.includes(side)) return [];
  return [{ level: 'error', message: 'Both leaders must share Heroism or Villainy', cards: [a.id, b.id] }];
}

/**
 * Each aspect icon on a card that your leaders and base don't provide makes it cost 2 more.
 * Icons are counted: a card with two Command icons needs two Commands between leaders and base.
 * It's a cost, not a rule, so it's a warning.
 */
export function aspectPenalty(card: SwuCard, have: string[]): number {
  const left = [...have];
  let missing = 0;
  for (const a of card.aspects) {
    const i = left.indexOf(a);
    if (i >= 0) left.splice(i, 1);
    else missing++;
  }
  return missing * 2;
}

function penaltyIssues(deck: Deck, cards: CardIndex<SwuCard>, have: string[]): Issue[] {
  const hit = (deck.zones.main ?? [])
    .map((e) => ({ e, c: cards.get(e.id) }))
    .filter((x): x is { e: Entry; c: SwuCard } => !!x.c)
    .map((x) => ({ ...x, p: aspectPenalty(x.c, have) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.c.name.localeCompare(b.c.name));
  if (!hit.length) return [];
  const names = hit.slice(0, 6).map((x) => `${x.c.name} (+${x.p})`);
  if (hit.length > 6) names.push(`and ${hit.length - 6} more`);
  const copies = hit.reduce((n, x) => n + x.e.qty, 0);
  return [{ level: 'warning', message: `Aspect penalty on ${copies} ${copies === 1 ? 'card' : 'cards'}: ${names.join(', ')}`, cards: hit.map((x) => x.c.id) }];
}

function validate(deck: Deck, cards: CardIndex<SwuCard>, format: FormatDef): Issue[] {
  const pick = (zone: string) => (deck.zones[zone] ?? []).flatMap((e) => Array.from({ length: e.qty }, () => cards.get(e.id))).filter((c): c is SwuCard => !!c);
  const leaders = pick('leader');
  const bases = pick('base');
  const twoLeaders = format.id !== 'premier';

  const issues: Issue[] = [
    ...exactZone(deck, 'leader', twoLeaders ? 2 : 1, 'leader'),
    ...exactZone(deck, 'base', 1, 'base'),
    ...(twoLeaders ? leaderSides(leaders) : []),
    ...sizeIssues(deck, format),
    ...(format.id === 'premier' ? zoneLimit(deck, 'side', 10, 'Sideboard') : []),
    ...copyIssues(game, deck, cards, format),
    ...misplaced(game, deck, cards, format),
    ...unknownCards(deck, cards),
  ];
  if (leaders.length && bases.length) issues.push(...penaltyIssues(deck, cards, [...leaders, ...bases].flatMap((c) => c.aspects)));
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Decklists: the JSON SWUDB and Karabast use, or plain text.

interface SwudbEntry {
  id: string;
  count: number;
}
interface SwudbDeck {
  metadata?: { name?: string; author?: string };
  leader?: SwudbEntry;
  secondleader?: SwudbEntry;
  base?: SwudbEntry;
  deck?: SwudbEntry[];
  sideboard?: SwudbEntry[];
}

function exportDeck(deck: Deck): string {
  const one = (zone: string, i = 0) => {
    const e = (deck.zones[zone] ?? []).flatMap((x) => Array.from({ length: x.qty }, () => x.id))[i];
    return e ? { id: e, count: 1 } : undefined;
  };
  const list = (zone: string) => (deck.zones[zone] ?? []).map((e) => ({ id: e.id, count: e.qty }));
  const out: SwudbDeck = { metadata: { name: deck.name, author: '' }, leader: one('leader'), secondleader: one('leader', 1), base: one('base'), deck: list('main') };
  if (deck.zones.side?.length) out.sideboard = list('side');
  return JSON.stringify(out, null, 2);
}

function importDeck(text: string, cards: CardIndex<SwuCard>, all: FormatDef[]): Imported {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return parseTextDeck(game, trimmed, cards, all[0]);

  let json: SwudbDeck;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error("That looks like JSON but couldn't be read");
  }
  const zones: Record<string, Entry[]> = {};
  const skipped: string[] = [];
  const add = (zone: string, x: SwudbEntry | undefined) => {
    if (!x?.id) return;
    const c = cards.get(x.id);
    if (!c) return void skipped.push(x.id);
    const list = (zones[zone] ??= []);
    const e = list.find((y) => y.id === c.id);
    if (e) e.qty += x.count || 1;
    else list.push({ id: c.id, qty: x.count || 1, owned: 0 });
  };
  add('leader', json.leader);
  add('leader', json.secondleader);
  add('base', json.base);
  for (const x of json.deck ?? []) add('main', x);
  for (const x of json.sideboard ?? []) add('side', x);
  if (!Object.keys(zones).length) throw new Error('No cards found in that decklist');
  const size = (zones.main ?? []).reduce((n, e) => n + e.qty, 0);
  const format = json.secondleader ? (size <= 63 ? 'order66' : 'twinsuns') : 'premier';
  return { name: json.metadata?.name || undefined, format, zones, skipped };
}

// ---------------------------------------------------------------------------------------------

const ASPECTS = ['Vigilance', 'Command', 'Aggression', 'Cunning', 'Heroism', 'Villainy'];
const SETS = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'IBH', 'SEC', 'LAW', 'TS26', 'ASH', 'HMW'];
const unitGroup = (c: SwuCard) => (c.arenas.includes('Space') ? 'Space units' : 'Ground units');

export const game: GameDef<SwuCard> = {
  id: 'swu',
  title: "Milk's SWU Deck Builder",
  game: 'Star Wars: Unlimited',
  formats,
  zoneFor: (c) => (c.type === 'Leader' ? 'leader' : c.type === 'Base' ? 'base' : 'main'),
  maxCopies,
  validate,

  label,
  group: (c) => (c.type === 'Leader' ? 'Leaders' : c.type === 'Base' ? 'Bases' : c.type === 'Unit' ? unitGroup(c) : `${c.type}s`),
  groups: ['Leaders', 'Bases', 'Ground units', 'Space units', 'Events', 'Upgrades'],
  cost: (c) => (isDeckCard(c) ? c.cost : null),
  image: (c) => ({
    src: `https://cdn.swu-db.com/images/cards/${c.img}.png`,
    back: c.backImg ? `https://cdn.swu-db.com/images/cards/${c.backImg}.png` : undefined,
    landscape: !isDeckCard(c),
  }),
  details: (c) => {
    const rows: [string, string][] = [['Type', c.type + (c.unique ? ' · Unique' : '')]];
    if (c.cost != null) rows.push(['Cost', String(c.cost)]);
    if (c.power != null || c.hp != null) rows.push([c.type === 'Upgrade' ? 'Bonus' : 'Power / HP', `${c.power ?? '–'} / ${c.hp ?? '–'}`]);
    else if (c.hp != null) rows.push(['HP', String(c.hp)]);
    if (c.arenas.length) rows.push(['Arena', c.arenas.join(', ')]);
    rows.push(['Aspects', c.aspects.length ? c.aspects.join(', ') : 'None']);
    if (c.traits.length) rows.push(['Traits', c.traits.join(', ')]);
    if (c.keywords?.length) rows.push(['Keywords', c.keywords.join(', ')]);
    rows.push(['Set', `${c.set} · ${c.rarity}`]);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => [c.text, c.epic, c.back && `Deployed: ${c.back}`].filter((x): x is string => !!x),
  searchText: (c) => [c.name, c.sub, c.type, ...c.traits, ...(c.keywords ?? []), ...c.aspects, c.text, c.epic, c.back, c.set].filter(Boolean).join(' ').toLowerCase(),
  filters: [
    { id: 'type', label: 'Type', values: (c) => [c.type], options: ['Leader', 'Base', 'Unit', 'Event', 'Upgrade'] },
    { id: 'aspect', label: 'Aspect', values: (c) => (c.aspects.length ? [...new Set(c.aspects)] : ['None']), options: [...ASPECTS, 'None'] },
    { id: 'cost', label: 'Cost', values: (c) => (c.cost == null || !isDeckCard(c) ? [] : [c.cost >= 8 ? '8+' : String(c.cost)]), options: ['0', '1', '2', '3', '4', '5', '6', '7', '8+'] },
    { id: 'arena', label: 'Arena', values: (c) => c.arenas, options: ['Ground', 'Space'] },
    { id: 'rarity', label: 'Rarity', values: (c) => [c.rarity], options: ['Common', 'Uncommon', 'Rare', 'Legendary', 'Special'] },
    { id: 'set', label: 'Set', values: (c) => [c.set], options: SETS },
  ],

  fit: {
    label: 'No aspect penalty',
    test: (c, deck, cards) => {
      if (!isDeckCard(c)) return true;
      const have = [...(deck.zones.leader ?? []), ...(deck.zones.base ?? [])].flatMap((e) => Array.from({ length: e.qty }, () => cards.get(e.id)?.aspects ?? []).flat());
      return aspectPenalty(c, have) === 0;
    },
  },

  importHint: 'Paste SWUDB / Karabast JSON, or a plain list ("3 Card Name" per line).',
  exportLabel: 'Copy JSON (SWUDB / Karabast)',
  exportDeck,
  importDeck,
  // TCGplayer names cards "Name - Subtitle", except bases, which go by name alone.
  massEntryLine: (c, n) => `${n} ${c.sub && c.type !== 'Base' ? `${c.name} - ${c.sub}` : c.name}`,
};
