// Union Arena for the shared deck builder: card shape, the official format, and its deck rules.

import { copyIssues, legalityIssues, misplaced, sizeIssues, unknownCards } from '@milk/core/rules';
import type { Card, CardIndex, Deck, Entry, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

export interface UaCard extends Card {
  /** The card number after the "/", e.g. "CSM-1-001". Copy limits count card numbers. */
  id: string;
  type: 'Character' | 'Event' | 'Site' | string;
  /** Title code, e.g. "CSM". A deck is all one title. */
  title: string;
  /** The series' name, e.g. "CHAINSAW MAN". */
  series: string;
  color?: string;
  /** Energy needed on your field to play it. */
  energy: number | null;
  /** Action Points to play it. */
  ap: number | null;
  /** Battle points, e.g. "2000" or "1000+". */
  bp?: string;
  /** Energy it generates, e.g. "P" or "PP". */
  generates?: string;
  /** Life trigger keyword: Special, Color, Final, Draw, Get, Active, Raid. */
  trigger?: string;
  triggerText?: string;
  rarity: string;
  text?: string;
  /** English release date, YYYY-MM-DD (missing for promo-only cards). */
  released?: string;
  /** TCGplayer product id of the printing whose picture we show. */
  img: number;
}

export const formats: FormatDef[] = [
  {
    id: 'standard',
    name: 'Official',
    summary: 'Exactly 50 cards from one series, up to 4 per card number, at most 4 each of Special, Color and Final triggers',
    zones: [{ id: 'main', name: 'Deck', max: 100 }],
    size: { zones: ['main'], target: 50, exact: true },
  },
];

// ---------------------------------------------------------------------------------------------
// The official restricted list, from unionarena-tcg.com/na/rules/limited.php (Nov 1, 2026 update).
// Nothing is banned. Update when Bandai announces changes.

/** Card number -> copies allowed, optionally from a date. */
const RESTRICTED: Record<string, { copies: number; from?: string }> = {
  'SLG-1-035': { copies: 2, from: '2026-11-01' }, // Monarch's Domain
  'EVA-1-051': { copies: 1 }, // Asuka Shikinami Langley
  'EVA-1-063': { copies: 1 }, // Spear of Gaius
};
const BANNED = new Set<string>([]);
/** Life triggers a deck may hold at most 4 of, each. */
const LIMITED_TRIGGERS = ['Special', 'Color', 'Final'];

const today = () => new Date().toISOString().slice(0, 10);
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function illegal(card: UaCard, _format: FormatDef, day = today()): string | null {
  if (BANNED.has(card.id)) return 'banned';
  if (card.released && card.released > day) return `not released until ${fmtDay(card.released)}`;
  return null;
}

export function maxCopies(card: UaCard, _format?: FormatDef, day = today()): number {
  const r = RESTRICTED[card.id];
  return r && (!r.from || day >= r.from) ? r.copies : 4;
}

/** The deck's series: whichever title most of its cards are from. */
export function deckTitle(deck: Deck, cards: CardIndex<UaCard>): string | null {
  const count = new Map<string, number>();
  for (const e of deck.zones.main ?? []) {
    const c = cards.get(e.id);
    if (c) count.set(c.title, (count.get(c.title) ?? 0) + e.qty);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function titleIssues(deck: Deck, cards: CardIndex<UaCard>): Issue[] {
  const title = deckTitle(deck, cards);
  if (!title) return [];
  const off = (deck.zones.main ?? []).map((e) => cards.get(e.id)).filter((c): c is UaCard => !!c && c.title !== title);
  if (!off.length) return [];
  const series = [...cards.values()].find((c) => c.title === title)?.series ?? title;
  return [{ level: 'error', message: `Not ${series} (a deck is one series): ${off.map(label).join(', ')}`, cards: off.map((c) => c.id) }];
}

function triggerIssues(deck: Deck, cards: CardIndex<UaCard>): Issue[] {
  const issues: Issue[] = [];
  for (const t of LIMITED_TRIGGERS) {
    const with_ = (deck.zones.main ?? []).filter((e) => cards.get(e.id)?.trigger === t);
    const n = with_.reduce((s, e) => s + e.qty, 0);
    if (n > 4) issues.push({ level: 'error', message: `${n} cards with a ${t} trigger, max 4`, cards: with_.map((e) => e.id) });
  }
  return issues;
}

function validate(deck: Deck, cards: CardIndex<UaCard>, format: FormatDef): Issue[] {
  return [
    ...sizeIssues(deck, format),
    ...titleIssues(deck, cards),
    ...triggerIssues(deck, cards),
    ...legalityIssues(game, deck, cards, format),
    ...copyIssues(game, deck, cards, format),
    ...misplaced(game, deck, cards, format),
    ...unknownCards(deck, cards),
  ];
}

// ---------------------------------------------------------------------------------------------
// Decklists: one card per line with its number ("4 CSM-1-001 Kobeni", "4x UE22BT/CSM-1-001").

// "UA01BT/JJK-1-001", or a promo like "NIK-P-001".
const CARD_NUMBER = /(?:[A-Z0-9]+\/)?([A-Z0-9]{3}-(?:\d+|P)-\d{3})/i;

function exportDeck(deck: Deck, cards: CardIndex<UaCard>): string {
  return [`// ${deck.name}`, ...(deck.zones.main ?? []).map((e) => `${e.qty} ${e.id} ${cards.get(e.id)?.name ?? ''}`.trim())].join('\n');
}

function importDeck(text: string, cards: CardIndex<UaCard>): Imported {
  const main: Entry[] = [];
  const skipped: string[] = [];
  let name: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) {
      if (!main.length && !name) name = line.replace(/^(\/\/|#)\s*/, '') || undefined;
      continue;
    }
    const m = CARD_NUMBER.exec(line);
    const c = m ? cards.get(m[1].toUpperCase()) : undefined;
    if (!c) {
      if (/\d/.test(line)) skipped.push(line);
      continue;
    }
    const qty = /^(\d+)\s*x?\s/i.exec(line);
    const n = qty ? Number(qty[1]) : 1;
    const e = main.find((x) => x.id === c.id);
    if (e) e.qty += n;
    else main.push({ id: c.id, qty: n, owned: 0 });
  }
  if (!main.length) throw new Error('No card numbers recognised in that list');
  return { name, format: 'standard', zones: { main }, skipped };
}

// ---------------------------------------------------------------------------------------------

const label = (c: UaCard) => `${c.name} · ${c.id}`;

export const game: GameDef<UaCard> = {
  id: 'unionarena',
  title: "Milk's Union Arena Deck Builder",
  game: 'Union Arena',
  formats,
  zoneFor: () => 'main',
  maxCopies: (c) => maxCopies(c),
  illegal: (c, f) => illegal(c, f),
  validate,

  label,
  group: (c) => (c.type === 'Character' ? 'Characters' : `${c.type}s`),
  groups: ['Characters', 'Events', 'Sites'],
  // Energy needed is what shapes a Union Arena curve (almost everything costs 1 AP).
  cost: (c) => c.energy,
  image: (c) => ({ src: `https://tcgplayer-cdn.tcgplayer.com/product/${c.img}_400w.jpg` }),
  details: (c) => {
    const rows: [string, string][] = [['Type', c.type]];
    rows.push(['Series', c.series]);
    if (c.color) rows.push(['Color', c.color]);
    if (c.energy != null) rows.push(['Energy needed', String(c.energy)]);
    if (c.ap != null) rows.push(['AP', String(c.ap)]);
    if (c.bp) rows.push(['BP', c.bp]);
    if (c.generates) rows.push(['Generates', c.generates]);
    if (c.trigger) rows.push(['Trigger', c.trigger]);
    rows.push(['Card', `${c.id} · ${c.rarity}`]);
    const r = RESTRICTED[c.id];
    if (r) rows.push(['Restricted', `Max ${r.copies} per deck${r.from ? ` from ${fmtDay(r.from)}` : ''}`]);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => [c.text, c.triggerText && `Trigger: ${c.triggerText}`].filter((x): x is string => !!x),
  searchText: (c) => [c.name, c.id, c.type, c.series, c.color, c.trigger, c.text, c.triggerText].filter(Boolean).join(' ').toLowerCase(),
  filters: [
    { id: 'series', label: 'Series', values: (c) => [c.series] },
    { id: 'type', label: 'Type', values: (c) => [c.type], options: ['Character', 'Event', 'Site'] },
    { id: 'color', label: 'Color', values: (c) => (c.color ? [c.color] : []), options: ['Red', 'Blue', 'Green', 'Yellow', 'Purple'] },
    { id: 'energy', label: 'Energy', values: (c) => (c.energy == null ? [] : [c.energy >= 7 ? '7+' : String(c.energy)]), options: ['0', '1', '2', '3', '4', '5', '6', '7+'] },
    { id: 'trigger', label: 'Trigger', values: (c) => [c.trigger ?? 'None'], options: ['Special', 'Color', 'Final', 'Raid', 'Active', 'Draw', 'Get', 'None'] },
    { id: 'rarity', label: 'Rarity', values: (c) => [c.rarity] },
  ],
  stats: ['color', 'trigger', 'type'],

  fit: {
    label: "This deck's series only",
    miss: (c, deck, cards) => {
      const t = deckTitle(deck, cards);
      return t && c.title !== t ? 'Other series' : null;
    },
    test: (c, deck, cards) => {
      const t = deckTitle(deck, cards);
      return !t || c.title === t;
    },
  },

  goldfish: {
    hand: 7,
    mulligans: 1,
    draw: 1,
    turn: 'Turn',
    stack: { name: 'Life', count: 7 },
    counter: { name: 'AP', first: 1, perTurn: 1, max: 3 },
    zones: ['main'],
    note: 'Draw 7 and mulligan once if you like; 7 life cards are dealt when turn 1 starts. Going first: no draw and 1 AP on turn 1. Going second, add 1 AP with the + button.',
    odds: [
      { label: 'Character needing 0–1 energy', test: (c) => c.type === 'Character' && c.energy != null && c.energy <= 1 },
      { label: 'Character needing 2–3 energy', test: (c) => c.type === 'Character' && c.energy != null && c.energy >= 2 && c.energy <= 3 },
      { label: 'Event', test: (c) => c.type === 'Event' },
      { label: 'Raid card', test: (c) => c.trigger === 'Raid' },
    ],
  },

  importHint: 'Paste one card per line with its number, like "4 CSM-1-001" or "4x UE22BT/CSM-1-001".',
  exportLabel: 'Copy decklist (with card numbers)',
  exportDeck,
  importDeck,
  tcgProductLine: 'Union Arena',
  massEntryById: true,
};
