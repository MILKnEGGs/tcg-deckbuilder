// Disney Lorcana for the shared deck builder: Core and Infinity Constructed.
//
// Deck rules: at least 60 cards, up to 4 copies of a card (name plus version), and no more than 2 ink
// colors; a dual-ink card counts as both of its inks. Legality per format, bans included, comes from
// Lorcast with the card data, so rotation and ban changes need no code changes.

import { parseTextDeck } from '@milk/core/import';
import { copyIssues, legalityIssues, misplaced, sizeIssues, unknownCards } from '@milk/core/rules';
import type { Badge, Card, CardIndex, Deck, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

export interface LorCard extends Card {
  version?: string;
  type: 'Character' | 'Action' | 'Song' | 'Item' | 'Location' | string;
  /** One ink, or two for dual-ink cards. */
  inks: string[];
  /** Can go into the inkwell. */
  inkable: boolean;
  cost: number | null;
  strength: number | null;
  willpower: number | null;
  lore: number | null;
  moveCost: number | null;
  classifications: string[];
  keywords?: string[];
  text?: string;
  rarity: string;
  set: string;
  sets: string[];
  released?: string;
  landscape?: true;
  core: 'legal' | 'not_legal' | 'banned';
  infinity: 'legal' | 'not_legal' | 'banned';
  img?: string;
}

const zones = () => [{ id: 'main', name: 'Deck', max: 120 }];

export const formats: FormatDef[] = [
  {
    id: 'core',
    name: 'Core',
    summary: '60+ cards, up to 4 of each, at most 2 inks. The rotating tournament format',
    zones: zones(),
    size: { zones: ['main'], target: 60 },
  },
  {
    id: 'infinity',
    name: 'Infinity',
    summary: 'Core deck rules with every set legal (its own ban list)',
    zones: zones(),
    size: { zones: ['main'], target: 60 },
  },
];

export const INKS = ['Amber', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Steel'];
const label = (c: LorCard) => (c.version ? `${c.name} - ${c.version}` : c.name);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function illegal(card: LorCard, format: FormatDef, day = today()): string | null {
  const status = format.id === 'infinity' ? card.infinity : card.core;
  if (status === 'banned') return `banned in ${format.name}`;
  if (card.released && card.released > day) return `not released until ${fmtDay(card.released)}`;
  if (status !== 'legal') return format.id === 'core' ? 'not in a Core-legal set' : `not legal in ${format.name}`;
  return null;
}

/** A card's own copy limit: "You may have up to 99 copies of …", "any number of cards named …". */
export function maxCopies(card: LorCard): number {
  const t = card.text ?? '';
  if (/any number of cards named/i.test(t)) return 99;
  const m = /You may have up to (\d+) copies of/i.exec(t);
  return m ? Number(m[1]) : 4;
}

/** Every ink the deck's cards use (a dual-ink card adds both). */
export function deckInks(deck: Deck, cards: CardIndex<LorCard>): string[] {
  const inks = new Set<string>();
  for (const e of deck.zones.main ?? []) for (const i of cards.get(e.id)?.inks ?? []) inks.add(i);
  return INKS.filter((i) => inks.has(i));
}

function inkIssues(deck: Deck, cards: CardIndex<LorCard>): Issue[] {
  const inks = deckInks(deck, cards);
  if (inks.length <= 2) return [];
  // Name the cards of the least-used inks, which are most likely the ones to cut.
  const count = new Map(inks.map((i) => [i, 0]));
  for (const e of deck.zones.main ?? []) for (const i of cards.get(e.id)?.inks ?? []) count.set(i, (count.get(i) ?? 0) + e.qty);
  const keep = [...count].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([i]) => i);
  const off = (deck.zones.main ?? []).map((e) => cards.get(e.id)).filter((c): c is LorCard => !!c && c.inks.some((i) => !keep.includes(i)));
  return [
    {
      level: 'error',
      message: `${inks.length} inks: ${inks.join(', ')}. Decks can use 2${off.length ? `; outside ${keep.join('/')}: ${off.slice(0, 6).map(label).join(', ')}${off.length > 6 ? ` and ${off.length - 6} more` : ''}` : ''}`,
      cards: off.map((c) => c.id),
    },
  ];
}

function validate(deck: Deck, cards: CardIndex<LorCard>, format: FormatDef): Issue[] {
  return [
    ...sizeIssues(deck, format),
    ...inkIssues(deck, cards),
    ...legalityIssues(game, deck, cards, format),
    ...copyIssues(game, deck, cards, format),
    ...misplaced(game, deck, cards, format),
    ...unknownCards(deck, cards),
  ];
}

const inkableCount = (deck: Deck, cards: CardIndex<LorCard>) => (deck.zones.main ?? []).reduce((n, e) => n + (cards.get(e.id)?.inkable ? e.qty : 0), 0);

// ---------------------------------------------------------------------------------------------

const INK_STYLE: Record<string, string> = { Amber: '#f59e0b', Amethyst: '#a855f7', Emerald: '#10b981', Ruby: '#e11d48', Sapphire: '#0ea5e9', Steel: '#94a3b8' };

function exportDeck(deck: Deck, cards: CardIndex<LorCard>): string {
  return (deck.zones.main ?? []).map((e) => `${e.qty} ${cards.get(e.id) ? label(cards.get(e.id)!) : e.id}`).join('\n');
}

function importDeck(text: string, cards: CardIndex<LorCard>, all: FormatDef[]): Imported {
  return { ...parseTextDeck(game, text, cards, all[0]), format: 'core' };
}

export const game: GameDef<LorCard> = {
  id: 'lorcana',
  title: "Milk's Lorcana Deck Builder",
  game: 'Disney Lorcana',
  formats,
  zoneFor: () => 'main',
  maxCopies: (c) => maxCopies(c),
  illegal: (c, f) => illegal(c, f),
  validate,

  label,
  group: (c) => `${c.type}s`,
  groups: ['Characters', 'Actions', 'Songs', 'Items', 'Locations'],
  cost: (c) => c.cost,
  image: (c) => ({ src: c.img ?? '', landscape: !!c.landscape }),
  // Names are printed partway down the card, so label the Deck view's stacks.
  labelStacks: true,
  meters: (deck, cards) => {
    const total = (deck.zones.main ?? []).reduce((n, e) => n + e.qty, 0);
    return total ? [{ label: 'inkable', value: inkableCount(deck, cards), max: total }] : [];
  },
  badges: (c): Badge[] => [
    ...c.inks.map((i) => ({ text: i.charAt(0) + (i === 'Amethyst' ? 'm' : ''), title: i, color: INK_STYLE[i] })),
    ...(c.inkable ? [{ text: '◆', title: 'Inkable', color: '#e5e7eb', square: true }] : []),
  ],
  details: (c) => {
    const rows: [string, string][] = [['Type', c.type + (c.classifications.length ? ` · ${c.classifications.join(', ')}` : '')]];
    rows.push(['Ink', `${c.inks.join(' / ') || '—'}${c.inkable ? ' · inkable' : ' · not inkable'}`]);
    if (c.cost != null) rows.push(['Cost', String(c.cost)]);
    if (c.strength != null || c.willpower != null) rows.push(['Strength / willpower', `${c.strength ?? '–'} / ${c.willpower ?? '–'}`]);
    if (c.lore != null) rows.push(['Lore', String(c.lore)]);
    if (c.moveCost != null) rows.push(['Move cost', String(c.moveCost)]);
    if (c.keywords?.length) rows.push(['Keywords', c.keywords.join(', ')]);
    rows.push(['Set', `${c.sets.join(', ')} · ${c.rarity}`]);
    rows.push(['Core', c.core === 'legal' ? 'Legal' : c.core === 'banned' ? 'Banned' : 'Not legal (rotated or not yet legal)']);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => (c.text ? [c.text] : []),
  searchText: (c) => [c.name, c.version, c.type, ...c.inks, ...c.classifications, ...(c.keywords ?? []), c.text, ...c.sets].filter(Boolean).join(' ').toLowerCase(),
  filters: [
    { id: 'ink', label: 'Ink', values: (c) => c.inks, options: INKS },
    { id: 'type', label: 'Type', values: (c) => [c.type], options: ['Character', 'Action', 'Song', 'Item', 'Location'] },
    { id: 'cost', label: 'Cost', values: (c) => (c.cost == null ? [] : [c.cost >= 9 ? '9+' : String(c.cost)]), options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9+'] },
    { id: 'inkable', label: 'Inkwell', values: (c) => [c.inkable ? 'Inkable' : 'Not inkable'], options: ['Inkable', 'Not inkable'] },
    { id: 'class', label: 'Class', values: (c) => c.classifications },
    { id: 'set', label: 'Set', values: (c) => c.sets },
    { id: 'rarity', label: 'Rarity', values: (c) => [c.rarity], options: ['Common', 'Uncommon', 'Rare', 'Super rare', 'Legendary', 'Promo'] },
  ],
  stats: ['ink', 'type', 'inkable'],

  fit: {
    label: 'Fits my inks',
    miss: (c, deck, cards) => {
      const inks = new Set([...deckInks(deck, cards), ...c.inks]);
      return inks.size > 2 ? 'Third ink' : null;
    },
    test: (c, deck, cards) => new Set([...deckInks(deck, cards), ...c.inks]).size <= 2,
  },

  goldfish: {
    hand: 7,
    mulligans: 1,
    draw: 1,
    turn: 'Turn',
    resources: { setup: 0, perTurn: 1, firstTurn: true, action: 'Ink', pile: 'Inkwell' },
    canResource: (c) => c.inkable,
    zones: ['main'],
    counter: { name: 'Lore', first: 0, perTurn: 0, max: 20 },
    note: 'Draw 7 and mulligan once if you like. Each turn you may put one inkable card into your inkwell. Going first skips the turn 1 draw. First to 20 lore wins.',
    odds: [
      { label: 'Cost 1–2 card', test: (c) => c.cost != null && c.cost <= 2 },
      { label: 'Cost 3 card', test: (c) => c.cost === 3 },
      { label: 'Song', test: (c) => c.type === 'Song' },
      { label: 'Inkable card', test: (c) => c.inkable },
    ],
  },

  importHint: 'Paste a list like "4 Stitch - Rock Star" per line (the format most Lorcana sites export).',
  exportLabel: 'Copy decklist (text)',
  exportDeck,
  importDeck,
  tcgProductLine: 'Lorcana TCG',
  massEntryById: true,
};
