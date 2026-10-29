// Dragon Ball Super Card Game Fusion World for the shared deck builder: card shape, the format, deck rules.

import { copyIssues, exactZone, legalityIssues, misplaced, sizeIssues, unknownCards } from '@milk/core/rules';
import { sizeOf } from '@milk/core/deck';
import type { Card, CardIndex, Deck, Entry, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

export interface FwCard extends Card {
  /** The card number, e.g. "FB01-001" or a starter deck's "FS05-01". Copy limits count card numbers. */
  id: string;
  type: 'Leader' | 'Battle' | 'Extra' | string;
  colors: string[];
  /** Energy to play it; null on leaders. */
  cost: number | null;
  /** Energy that must be the card's color, as letters: "RR" is 2 red. */
  colorCost: string;
  /** Leaders: the front's power. */
  power: number | null;
  /** Combo power on battle cards (+5000 / +10000). */
  combo: number | null;
  traits: string[];
  rarity: string;
  text?: string;
  /** Set code from the card number: "FB01", "FS05", "SB01", "FP". */
  set: string;
  /** English release date, YYYY-MM-DD (missing for promo-only cards). */
  released?: string;
  /** Leaders: Bandai's picture of the front (TCGplayer's may show either side). */
  front?: string;
  /** Leaders' awakened side. */
  back?:{ name: string; power: number | null; text?: string; img: string };
  /** TCGplayer product id of the printing whose picture we show. */
  img: number;
}

export const MIN = 50;
export const MAX = 60;

export const formats: FormatDef[] = [
  {
    id: 'standard',
    name: 'Standard',
    summary: `1 leader + ${MIN} to ${MAX} cards in its colors, up to 4 per card number`,
    zones: [
      { id: 'leader', name: 'Leader', max: 1, command: true },
      { id: 'main', name: 'Deck', max: 100 },
    ],
    size: { zones: ['main'], target: MIN },
  },
];

// ---------------------------------------------------------------------------------------------
// The official banned/restricted list, from dbs-cardgame.com/fw/en/news/01_305.html (effective March 2026,
// still the current one on the rules page in October 2026). Update when Bandai announces changes.

const BANNED = new Set(['FB01-056', 'FB01-005', 'FB02-031']); // Pilaf, Master Roshi, Ribrianne
/** Restricted to 1 copy. */
const RESTRICTED = new Set(['FB04-085', 'FB04-094', 'FB04-095', 'SB01-011', 'SB01-015']); // Babidi, Majin Buu : Kid ×2, Cell, Self-Destruct

/** Cards with [Dragon Ball]: any mix of them, up to 7 in total. */
export const DRAGON_BALLS = 7;
export const isDragonBall = (c: FwCard) => /^\[Dragon Ball\]/m.test(c.text ?? '');

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function illegal(card: FwCard, _format: FormatDef, today = new Date().toISOString().slice(0, 10)): string | null {
  if (BANNED.has(card.id)) return 'banned';
  if (/can only be used in specified events/i.test(card.text ?? '')) return 'only for specified events';
  if (card.released && card.released > today) return `not released until ${fmtDay(card.released)}`;
  return null;
}

export function maxCopies(card: FwCard): number {
  if (card.type === 'Leader') return 1;
  if (/include as many copies of this card in your deck as you like/i.test(card.text ?? '')) return 99;
  if (isDragonBall(card)) return DRAGON_BALLS;
  return RESTRICTED.has(card.id) ? 1 : 4;
}

const leaderOf = (deck: Deck, cards: CardIndex<FwCard>) => cards.get(deck.zones.leader?.[0]?.id ?? '');

/** No card with a color the leader lacks (official rule 6-1-4-1). */
export const fitsLeader = (card: FwCard, leader: FwCard | undefined) =>
  !leader || card.type === 'Leader' || card.colors.every((c) => leader.colors.includes(c));

function colorIssues(deck: Deck, cards: CardIndex<FwCard>): Issue[] {
  const leader = leaderOf(deck, cards);
  if (!leader) return [];
  const off = (deck.zones.main ?? []).map((e) => cards.get(e.id)).filter((c): c is FwCard => !!c && !fitsLeader(c, leader));
  if (!off.length) return [];
  return [
    {
      level: 'error',
      message: `Not in ${leader.name}'s color (${leader.colors.join('/')}): ${off.map((c) => c.name).join(', ')}`,
      cards: off.map((c) => c.id),
    },
  ];
}

/** At least 50 cards; anything up to 60 is just as legal, so no nagging between the two. */
function deckSize(deck: Deck, format: FormatDef): Issue[] {
  const n = sizeOf(deck, format);
  if (n > MAX) return [{ level: 'error', message: `Too many cards: ${n}/${MAX}. Cut ${n - MAX}` }];
  return n < MIN ? sizeIssues(deck, format) : [];
}

function dragonBallIssues(deck: Deck, cards: CardIndex<FwCard>): Issue[] {
  const balls = (deck.zones.main ?? []).filter((e) => {
    const c = cards.get(e.id);
    return c && isDragonBall(c);
  });
  const n = balls.reduce((s, e) => s + e.qty, 0);
  return n > DRAGON_BALLS ? [{ level: 'error', message: `${n} [Dragon Ball] cards, max ${DRAGON_BALLS} in total`, cards: balls.map((e) => e.id) }] : [];
}

function validate(deck: Deck, cards: CardIndex<FwCard>, format: FormatDef): Issue[] {
  return [
    ...exactZone(deck, 'leader', 1, 'leader'),
    ...deckSize(deck, format),
    ...colorIssues(deck, cards),
    ...legalityIssues(game, deck, cards, format),
    ...dragonBallIssues(deck, cards),
    ...copyIssues(game, deck, cards, format),
    ...misplaced(game, deck, cards, format),
    ...unknownCards(deck, cards),
  ];
}

// ---------------------------------------------------------------------------------------------
// Decklists: one card per line with its number, "4 FB01-035 Vegeta" or "4xFB01-035" (the name is optional).

// No word boundary at the start: in "4xFB01-035" the x runs straight into the number. Starter decks
// number their cards with two digits ("FS05-01").
const CARD_NUMBER = /((?:FB|FS|SB|ST)\d{2}-\d{2,3}|FP-\d{3})(?!\d)/i;

function exportDeck(deck: Deck, cards: CardIndex<FwCard>): string {
  const line = (e: Entry) => `${e.qty} ${e.id} ${cards.get(e.id)?.name ?? ''}`.trim();
  return [`// ${deck.name}`, ...(deck.zones.leader ?? []).map(line), ...(deck.zones.main ?? []).map(line)].join('\n');
}

function importDeck(text: string, cards: CardIndex<FwCard>): Imported {
  const zones: Record<string, Entry[]> = {};
  const skipped: string[] = [];
  let name: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) {
      if (!Object.keys(zones).length && !name) name = line.replace(/^(\/\/|#)\s*/, '') || undefined;
      continue;
    }
    const m = CARD_NUMBER.exec(line);
    const c = m ? cards.get(m[1].toUpperCase()) : undefined;
    if (!c) {
      if (/\d/.test(line)) skipped.push(line);
      continue;
    }
    const qty = /^(\d+)\s*x?/i.exec(line);
    const n = qty ? Number(qty[1]) : 1;
    const list = (zones[c.type === 'Leader' ? 'leader' : 'main'] ??= []);
    const e = list.find((x) => x.id === c.id);
    if (e) e.qty += n;
    else list.push({ id: c.id, qty: n, owned: 0 });
  }
  if (!Object.keys(zones).length) throw new Error('No card numbers recognised in that list');
  return { name, format: 'standard', zones, skipped };
}

// ---------------------------------------------------------------------------------------------

const label = (c: FwCard) => `${c.name} · ${c.id}`;
const COLORS = ['Red', 'Blue', 'Green', 'Yellow', 'Black'];
const power = (n: number | null) => (n == null ? '—' : n.toLocaleString());

export const game: GameDef<FwCard> = {
  id: 'fusionworld',
  title: "Milk's Fusion World Deck Builder",
  game: 'Dragon Ball Super Fusion World',
  formats,
  zoneFor: (c) => (c.type === 'Leader' ? 'leader' : 'main'),
  maxCopies,
  illegal: (c, f) => illegal(c, f),
  validate,

  label,
  setCode: (c) => c.set,
  group: (c) => (c.type === 'Leader' ? 'Leader' : `${c.type} Cards`),
  groups: ['Leader', 'Battle Cards', 'Extra Cards'],
  cost: (c) => c.cost,
  image: (c) => ({ src: c.front ?? `https://tcgplayer-cdn.tcgplayer.com/product/${c.img}_400w.jpg`, back: c.back?.img }),
  details: (c) => {
    const rows: [string, string][] = [['Type', c.type]];
    rows.push(['Color', c.colors.join(' / ') || '—']);
    if (c.cost != null) rows.push(['Cost', `${c.cost}${c.colorCost ? ` (${c.colorCost.length} ${c.colors[0]?.toLowerCase() ?? ''})` : ''}`.trim()]);
    if (c.back) rows.push(['Power', `${power(c.power)} → ${power(c.back.power)} awakened`]);
    else if (c.power != null) rows.push(['Power', power(c.power)]);
    if (c.combo != null) rows.push(['Combo', `+${c.combo.toLocaleString()}`]);
    if (c.traits.length) rows.push(['Traits', c.traits.join(', ')]);
    rows.push(['Card', `${c.id} · ${c.rarity}`]);
    if (c.back && c.back.name !== c.name) rows.push(['Awakens into', c.back.name]);
    if (RESTRICTED.has(c.id)) rows.push(['Restricted', 'Max 1 per deck']);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => [...(c.text ? c.text.split('\n') : []), ...(c.back?.text ? [`Awakened (${c.back.name}): ${c.back.text.replace(/\n/g, ' ')}`] : [])],
  searchText: (c) => [c.name, c.id, c.type, ...c.colors, ...c.traits, c.text, c.back?.name, c.back?.text].filter(Boolean).join(' ').toLowerCase(),
  filters: [
    { id: 'type', label: 'Type', values: (c) => [c.type], options: ['Leader', 'Battle', 'Extra'] },
    { id: 'color', label: 'Color', values: (c) => c.colors, options: COLORS },
    { id: 'cost', label: 'Cost', values: (c) => (c.cost == null ? [] : [c.cost >= 8 ? '8+' : String(c.cost)]), options: ['0', '1', '2', '3', '4', '5', '6', '7', '8+'] },
    { id: 'combo', label: 'Combo', values: (c) => (c.type === 'Battle' ? [c.combo ? `+${c.combo}` : 'None'] : []), options: ['None', '+5000', '+10000'] },
    { id: 'rarity', label: 'Rarity', values: (c) => [c.rarity], options: ['Leader', 'Common', 'Uncommon', 'Rare', 'Super Rare', 'Secret Rare', 'Promo'] },
    { id: 'set', label: 'Set', values: (c) => [c.set] },
  ],
  stats: ['type', 'combo'],

  fit: {
    label: "Leader's color only",
    miss: (c, deck, cards) => (fitsLeader(c, leaderOf(deck, cards)) ? null : 'Off-color'),
    test: (c, deck, cards) => fitsLeader(c, leaderOf(deck, cards)),
    // Other colors can't go in the deck at all, so once there's a leader, show only its color.
    auto: (deck, cards) => !!leaderOf(deck, cards),
  },

  goldfish: {
    hand: 6,
    mulligans: 1,
    draw: 1,
    turn: 'Turn',
    stack: { name: 'Life', count: 8 },
    resources: { setup: 0, perTurn: 1, firstTurn: true, action: 'Charge', pile: 'Energy' },
    zones: ['main'],
    note: 'Draw 6 and redraw once if you like; 8 life cards are dealt when turn 1 starts. Each turn you may place 1 card from your hand as energy. Going first skips the turn 1 draw; going second also gets an energy marker.',
    odds: [
      { label: 'Battle card costing 1–2', test: (c) => c.type === 'Battle' && c.cost != null && c.cost <= 2 },
      { label: 'Battle card costing 3–4', test: (c) => c.type === 'Battle' && c.cost != null && c.cost >= 3 && c.cost <= 4 },
      { label: 'Battle card costing 5+', test: (c) => c.type === 'Battle' && c.cost != null && c.cost >= 5 },
      { label: 'Extra card', test: (c) => c.type === 'Extra' },
    ],
  },

  importHint: 'Paste one card per line with its number, like "4 FB01-035" or "4xFB01-035". The leader goes in by itself.',
  exportLabel: 'Copy decklist (with card numbers)',
  exportDeck,
  importDeck,
  tcgProductLine: 'Dragon Ball Super Fusion World',
  massEntryById: true,
};
