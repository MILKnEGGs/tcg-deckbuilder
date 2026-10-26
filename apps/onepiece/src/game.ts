// One Piece Card Game for the shared deck builder: card shape, Standard and Extra formats, deck rules.

import { copyIssues, exactZone, legalityIssues, misplaced, sizeIssues, unknownCards } from '@milk/core/rules';
import type { Card, CardIndex, Deck, Entry, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

export interface OpCard extends Card {
  /** The card number, e.g. "OP05-007". Copy limits count card numbers. */
  id: string;
  type: 'Leader' | 'Character' | 'Event' | 'Stage' | string;
  colors: string[];
  cost: number | null;
  power: number | null;
  /** Counter value (+1000 / +2000) on Characters. */
  counter: number | null;
  /** Leaders only: how many life cards you start with. */
  life: number | null;
  attribute?: string;
  traits: string[];
  rarity: string;
  text?: string;
  /** Set code from the card number: "OP05", "ST13", "EB01", "P". */
  set: string;
  /** English release date, YYYY-MM-DD (missing for promo-only cards). */
  released?: string;
  /** Block 1 (OP01–OP04, ST01–ST10 and their promos) and never reprinted: not legal in Standard. */
  rotated?: true;
  /** TCGplayer marks this printing "Not Tournament Legal". */
  notLegal?: true;
  /** TCGplayer product id of the printing whose picture we show. */
  img: number;
}

const zones = () => [
  { id: 'leader', name: 'Leader', max: 1, command: true },
  { id: 'main', name: 'Deck', max: 100 },
];

export const formats: FormatDef[] = [
  {
    id: 'standard',
    name: 'Standard',
    summary: '1 leader + exactly 50 cards in its colors, up to 4 per card number. Block 2 onward (OP05+)',
    zones: zones(),
    size: { zones: ['main'], target: 50, exact: true },
  },
  {
    id: 'extra',
    name: 'Extra Regulation',
    summary: 'Standard deck rules with every card legal (including Block 1)',
    zones: zones(),
    size: { zones: ['main'], target: 50, exact: true },
  },
];

// ---------------------------------------------------------------------------------------------
// The official banned list, from en.onepiece-cardgame.com/news/restriction.html (Oct 12, 2026).
// It applies to both formats. There are no restricted cards right now. Update when Bandai announces
// changes (usually twice a year).

const BANNED = new Set(['OP06-047', 'OP03-040', 'OP06-086', 'ST10-001', 'OP06-116', 'OP14-020']);
/** Restricted to 1 copy. Empty today; kept so a future announcement is a one-line change. */
const RESTRICTED = new Set<string>([]);
/** Banned pairs: card A and card B can't be in the same deck. */
const BANNED_PAIRS: [string, string][] = [
  ['OP07-115', 'EB04-058'], // I Re-Quasar Helllp!! / Borsalino
  ['OP11-040', 'OP11-067'], // Monkey.D.Luffy / Charlotte Katakuri
  ['OP11-040', 'OP08-069'], // Monkey.D.Luffy / Charlotte Linlin
];

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function illegal(card: OpCard, format: FormatDef, today = new Date().toISOString().slice(0, 10)): string | null {
  if (BANNED.has(card.id)) return 'banned';
  if (card.notLegal) return 'not tournament legal';
  if (card.released && card.released > today) return `not released until ${fmtDay(card.released)}`;
  if (format.id === 'standard' && card.rotated) return 'rotated out of Standard (Block 1)';
  return null;
}

/** A card's own deck-building limit ("A deck can include any number of this card"). */
export function printedLimit(card: OpCard): number | null {
  const t = card.text ?? '';
  if (/any number of (?:copies of )?(?:this card|cards with this card number)/i.test(t)) return 99;
  const m = /deck can (?:include|contain|have) up to (\d+) (?:copies of this card|cards with this card number)/i.exec(t);
  return m ? Number(m[1]) : null;
}

export function maxCopies(card: OpCard): number {
  if (card.type === 'Leader') return 1;
  return printedLimit(card) ?? (RESTRICTED.has(card.id) ? 1 : 4);
}

const leaderOf = (deck: Deck, cards: CardIndex<OpCard>) => cards.get(deck.zones.leader?.[0]?.id ?? '');

/** Every color on the card must be one of the leader's (official rule 5-1-2-2). */
export const fitsLeader = (card: OpCard, leader: OpCard | undefined) => !leader || card.type === 'Leader' || card.colors.every((c) => leader.colors.includes(c));

function colorIssues(deck: Deck, cards: CardIndex<OpCard>): Issue[] {
  const leader = leaderOf(deck, cards);
  if (!leader) return [];
  const off = (deck.zones.main ?? []).map((e) => cards.get(e.id)).filter((c): c is OpCard => !!c && !fitsLeader(c, leader));
  if (!off.length) return [];
  return [
    {
      level: 'error',
      message: `Not in ${leader.name}'s colors (${leader.colors.join('/')}): ${off.map((c) => c.name).join(', ')}`,
      cards: off.map((c) => c.id),
    },
  ];
}

function pairIssues(deck: Deck, cards: CardIndex<OpCard>): Issue[] {
  const ids = new Set(Object.values(deck.zones).flatMap((l) => l.map((e) => e.id)));
  return BANNED_PAIRS.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => ({
    level: 'error' as const,
    message: `Banned pair: ${cards.get(a) ? label(cards.get(a)!) : a} can't be in a deck with ${cards.get(b) ? label(cards.get(b)!) : b}`,
    cards: [a, b],
  }));
}

function validate(deck: Deck, cards: CardIndex<OpCard>, format: FormatDef): Issue[] {
  return [
    ...exactZone(deck, 'leader', 1, 'leader'),
    ...sizeIssues(deck, format),
    ...colorIssues(deck, cards),
    ...legalityIssues(game, deck, cards, format),
    ...pairIssues(deck, cards),
    ...copyIssues(game, deck, cards, format),
    ...misplaced(game, deck, cards, format),
    ...unknownCards(deck, cards),
  ];
}

// ---------------------------------------------------------------------------------------------
// Decklists: "4xOP05-007" per line, the format OPTCGSim, onepiece.gg and most One Piece sites use.

// No word boundary at the start: in "4xOP05-007" the x runs straight into the number.
const CARD_NUMBER = /((?:OP|ST|EB|PRB)\d{2}-\d{3}|P-\d{3})\b/i;

function exportDeck(deck: Deck): string {
  const line = (e: Entry) => `${e.qty}x${e.id}`;
  return [...(deck.zones.leader ?? []).map(line), ...(deck.zones.main ?? []).map(line)].join('\n');
}

function importDeck(text: string, cards: CardIndex<OpCard>): Imported {
  const zones: Record<string, Entry[]> = {};
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const m = CARD_NUMBER.exec(line);
    if (!m) {
      if (/\d/.test(line)) skipped.push(line);
      continue;
    }
    const c = cards.get(m[1].toUpperCase());
    if (!c) {
      skipped.push(line);
      continue;
    }
    const qty = /^(\d+)\s*x?/i.exec(line);
    const zone = c.type === 'Leader' ? 'leader' : 'main';
    const list = (zones[zone] ??= []);
    const e = list.find((x) => x.id === c.id);
    const n = qty ? Number(qty[1]) : 1;
    if (e) e.qty += n;
    else list.push({ id: c.id, qty: n, owned: 0 });
  }
  if (!Object.keys(zones).length) throw new Error('No card numbers recognised in that list');
  // Lists with Block 1 cards can only be Extra Regulation.
  const all = Object.values(zones).flat();
  const format = all.some((e) => cards.get(e.id)?.rotated) ? 'extra' : 'standard';
  return { format, zones, skipped };
}

// ---------------------------------------------------------------------------------------------

const label = (c: OpCard) => `${c.name} · ${c.id}`;
const COLORS = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];

export const game: GameDef<OpCard> = {
  id: 'onepiece',
  title: "Milk's One Piece Deck Builder",
  game: 'One Piece Card Game',
  formats,
  zoneFor: (c) => (c.type === 'Leader' ? 'leader' : 'main'),
  maxCopies,
  illegal: (c, f) => illegal(c, f),
  validate,

  label,
  setCode: (c) => c.set,
  group: (c) => (c.type === 'Leader' ? 'Leader' : c.type === 'Character' ? 'Characters' : `${c.type}s`),
  groups: ['Leader', 'Characters', 'Events', 'Stages'],
  cost: (c) => (c.type === 'Leader' ? null : c.cost),
  // TCGplayer's picture of the printing we price. Some are Bandai's official scans stamped "SAMPLE";
  // every free source uses those same scans, and these are the smallest (~70 KB).
  image: (c) => ({ src: `https://tcgplayer-cdn.tcgplayer.com/product/${c.img}_400w.jpg` }),
  details: (c) => {
    const rows: [string, string][] = [['Type', c.type + (c.attribute ? ` · ${c.attribute}` : '')]];
    rows.push(['Color', c.colors.join(' / ') || '—']);
    if (c.life != null) rows.push(['Life', String(c.life)]);
    if (c.cost != null) rows.push(['Cost', String(c.cost)]);
    if (c.power != null) rows.push(['Power', c.power.toLocaleString()]);
    if (c.counter != null) rows.push(['Counter', `+${c.counter.toLocaleString()}`]);
    if (c.traits.length) rows.push(['Types', c.traits.join(', ')]);
    rows.push(['Card', `${c.id} · ${c.rarity}`]);
    if (c.rotated) rows.push(['Standard', 'Rotated out (Block 1). Extra Regulation only']);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => (c.text ? [c.text] : []),
  searchText: (c) => [c.name, c.id, c.type, ...c.colors, c.attribute, ...c.traits, c.text].filter(Boolean).join(' ').toLowerCase(),
  filters: [
    { id: 'type', label: 'Type', values: (c) => [c.type], options: ['Leader', 'Character', 'Event', 'Stage'] },
    { id: 'color', label: 'Color', values: (c) => c.colors, options: COLORS },
    { id: 'cost', label: 'Cost', values: (c) => (c.cost == null || c.type === 'Leader' ? [] : [c.cost >= 10 ? '10+' : String(c.cost)]), options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'] },
    { id: 'counter', label: 'Counter', values: (c) => (c.type === 'Character' ? [c.counter ? `+${c.counter}` : 'None'] : []), options: ['None', '+1000', '+2000'] },
    { id: 'attribute', label: 'Attribute', values: (c) => (c.attribute ? c.attribute.split(/[;/]/).map((s) => s.trim()) : []), options: ['Slash', 'Strike', 'Ranged', 'Special', 'Wisdom'] },
    { id: 'rarity', label: 'Rarity', values: (c) => [c.rarity], options: ['L', 'C', 'UC', 'R', 'SR', 'SEC', 'SP', 'P', 'PR'] },
    { id: 'set', label: 'Set', values: (c) => [c.set] },
  ],
  stats: ['color', 'type', 'counter'],

  fit: {
    label: "Leader's colors only",
    miss: (c, deck, cards) => (fitsLeader(c, leaderOf(deck, cards)) ? null : 'Off-color'),
    test: (c, deck, cards) => fitsLeader(c, leaderOf(deck, cards)),
  },

  goldfish: {
    hand: 5,
    mulligans: 1,
    draw: 1,
    turn: 'Turn',
    stack: {
      name: 'Life',
      count: 5,
      countFrom: (deck, cards) => leaderOf(deck, cards)?.life ?? 5,
    },
    counter: { name: 'DON!!', first: 1, perTurn: 2, max: 10 },
    zones: ['main'],
    note: "Draw 5 and mulligan once if you like; life cards (your leader's life) are dealt when turn 1 starts. Going first: no draw and 1 DON!! on turn 1. Going second, add 1 DON!! with the + button.",
    odds: [
      { label: 'Character costing 1–2', test: (c) => c.type === 'Character' && c.cost != null && c.cost <= 2 },
      { label: 'Character costing 3–4', test: (c) => c.type === 'Character' && c.cost != null && c.cost >= 3 && c.cost <= 4 },
      { label: 'Counter card', test: (c) => (c.counter ?? 0) > 0 },
      { label: 'Event', test: (c) => c.type === 'Event' },
    ],
  },

  importHint: 'Paste a list like "4xOP05-007" per line (OPTCGSim, onepiece.gg and most One Piece sites).',
  exportLabel: 'Copy decklist (OPTCGSim format)',
  exportDeck,
  importDeck,
  tcgProductLine: 'One Piece Card Game',
  massEntryById: true,
};
