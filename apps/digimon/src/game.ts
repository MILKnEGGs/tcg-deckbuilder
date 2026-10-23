// Digimon Card Game for the shared deck builder: card shape, Standard format, deck rules and display.

import { copyIssues, legalityIssues, misplaced, sizeIssues, unknownCards, zoneLimit } from '@milk/core/rules';
import type { Card, CardIndex, Deck, Entry, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

export interface DigiCard extends Card {
  /** The card number, e.g. "BT1-010". Copy limits count card numbers. */
  id: string;
  type: 'Digimon' | 'Digi-Egg' | 'Tamer' | 'Option' | 'Dual' | string;
  colors: string[];
  level: number | null;
  playCost: number | null;
  digiCost: number | null;
  /** What it digivolves from, e.g. "Red Lv.2". */
  digiFrom?: string;
  dp: number | null;
  form?: string;
  attribute?: string;
  traits: string[];
  rarity: string;
  text?: string;
  inherited?: string;
  /** DNA / Xros / Link requirements. */
  special?: string;
  /** Set code from the card number: "BT1", "EX5", "ST9", "P". */
  set: string;
  /** English release date (first TCGplayer listing), YYYY-MM-DD. */
  released: string;
}

export const formats: FormatDef[] = [
  {
    id: 'standard',
    name: 'Standard',
    summary: '50-card deck + up to 5 Digi-Eggs, up to 4 of each card number',
    zones: [
      { id: 'egg', name: 'Digi-Egg deck', max: 15 },
      { id: 'main', name: 'Main deck', max: 100 },
    ],
    size: { zones: ['main'], target: 50, exact: true },
  },
];

// ---------------------------------------------------------------------------------------------
// The official banned and restricted list (English), from world.digimoncard.com/rule/restriction_card/.
// Last checked against the Aug 21, 2026 announcement. Update when Bandai announces changes.

const BANNED = new Set(['BT5-109', 'BT2-090', 'EX5-065', 'BT15-003']);

const RESTRICTED = new Set([
  'EX1-066', 'EX8-012', 'BT14-033', 'BT23-032', 'BT3-092', 'BT10-080', 'EX5-059', 'EX5-061', 'BT1-090', 'BT6-104',
  'BT13-110', 'BT16-011', 'EX3-057', 'EX4-006', 'EX1-021', 'BT19-040', 'EX2-070', 'BT4-111', 'BT17-069', 'BT4-104',
  'P-029', 'P-030', 'BT11-033', 'ST9-09', 'EX4-030', 'P-123', 'P-130', 'BT15-057', 'BT9-098', 'ST2-13',
  'BT14-084', 'BT14-002', 'BT15-102', 'EX5-015', 'EX5-018', 'EX5-062', 'BT13-012', 'BT2-069', 'BT7-069', 'BT3-054',
  'EX2-039', 'P-008', 'P-025', 'BT11-064', 'BT7-107', 'BT10-009', 'BT7-038', 'BT7-064', 'BT2-047', 'BT3-103',
  'BT6-100', 'EX1-068', 'BT7-072',
]);

/** Banned pairs: a deck with any card from `a` can't include any card from `b`. */
const BANNED_PAIRS: { a: string[]; b: string[] }[] = [
  { a: ['EX2-007'], b: ['EX7-064'] }, // Mother D-Reaper / Shoto Kazama
  { a: ['BT20-037'], b: ['BT17-035', 'EX8-037'] }, // Chaosmon: Valdur Arm / Taomon, Sakuyamon (X Antibody)
];

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function illegal(card: DigiCard, _format: FormatDef, today = new Date().toISOString().slice(0, 10)): string | null {
  if (BANNED.has(card.id)) return 'banned';
  if (card.released && card.released > today) return `not released in English until ${fmtDay(card.released)}`;
  return null;
}

/** Up to 4 of a card number, 1 if restricted. Banned cards are refused separately (illegal). */
export const maxCopies = (card: DigiCard) => (RESTRICTED.has(card.id) ? 1 : 4);

function pairIssues(deck: Deck, cards: CardIndex<DigiCard>): Issue[] {
  const ids = new Set(Object.values(deck.zones).flatMap((l) => l.map((e) => e.id)));
  const issues: Issue[] = [];
  for (const { a, b } of BANNED_PAIRS) {
    const hasA = a.filter((id) => ids.has(id));
    const hasB = b.filter((id) => ids.has(id));
    if (hasA.length && hasB.length) {
      const names = (list: string[]) => list.map((id) => (cards.get(id) ? label(cards.get(id)!) : id)).join(', ');
      issues.push({ level: 'error', message: `Banned pair: ${names(hasA)} can't be in a deck with ${names(hasB)}`, cards: [...hasA, ...hasB] });
    }
  }
  return issues;
}

function validate(deck: Deck, cards: CardIndex<DigiCard>, format: FormatDef): Issue[] {
  return [
    ...sizeIssues(deck, format, 'main deck cards'),
    ...zoneLimit(deck, 'egg', 5, 'Digi-Egg deck'),
    ...legalityIssues(game, deck, cards, format),
    ...pairIssues(deck, cards),
    ...copyIssues(game, deck, cards, format),
    ...misplaced(game, deck, cards, format),
    ...unknownCards(deck, cards),
  ];
}

// ---------------------------------------------------------------------------------------------
// Decklists: "4 Agumon BT1-010" lines (what most Digimon sites export), or the Tabletop Simulator
// JSON array of card numbers that digimoncard.io and DigimonMeta use.

const CARD_NUMBER = /\b((?:BT|EX|ST|RB|LM|AD)\d{1,2}-\d{2,3}|P-\d{3})\b/i;

function exportDeck(deck: Deck, cards: CardIndex<DigiCard>): string {
  const lines = (list: Entry[]) => list.map((e) => `${e.qty} ${cards.get(e.id)?.name ?? ''} ${e.id}`.replace(/\s+/g, ' '));
  return [`// ${deck.name}`, '// Digi-Egg deck', ...lines(deck.zones.egg ?? []), '', '// Main deck', ...lines(deck.zones.main ?? [])].join('\n');
}

function importDeck(text: string, cards: CardIndex<DigiCard>): Imported {
  const zones: Record<string, Entry[]> = {};
  const skipped: string[] = [];
  const add = (id: string, qty: number, raw: string) => {
    const c = cards.get(id.toUpperCase());
    if (!c) return void skipped.push(raw.trim());
    const zone = c.type === 'Digi-Egg' ? 'egg' : 'main';
    const list = (zones[zone] ??= []);
    const e = list.find((x) => x.id === c.id);
    if (e) e.qty += qty;
    else list.push({ id: c.id, qty, owned: 0 });
  };

  const trimmed = text.trim();
  let name: string | undefined;
  if (trimmed.startsWith('[')) {
    let arr: unknown;
    try {
      arr = JSON.parse(trimmed);
    } catch {
      throw new Error("That looks like JSON but couldn't be read");
    }
    if (!Array.isArray(arr)) throw new Error('Expected a list of card numbers');
    for (const x of arr) {
      if (typeof x !== 'string') continue;
      const m = CARD_NUMBER.exec(x);
      if (m) add(m[1], 1, x);
      else name ??= x.replace(/^exported from\s+/i, '').trim() || undefined;
    }
  } else {
    for (const raw of trimmed.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('#')) {
        // "// Deck name" on the first line, as our own export writes it.
        if (!Object.keys(zones).length && !name && /^\/\/\s*(?!digi-?egg|main|egg)/i.test(line)) name = line.replace(/^\/\/\s*/, '') || undefined;
        continue;
      }
      const m = CARD_NUMBER.exec(line);
      if (!m) {
        if (/\d/.test(line)) skipped.push(line);
        continue;
      }
      const qty = /^(\d+)\s*x?\b/i.exec(line);
      add(m[1], qty ? Number(qty[1]) : 1, line);
    }
  }
  if (!Object.keys(zones).length) throw new Error('No card numbers recognised in that list');
  return { name, format: 'standard', zones, skipped };
}

// ---------------------------------------------------------------------------------------------

const label = (c: DigiCard) => `${c.name} · ${c.id}`;
const COLORS = ['Red', 'Blue', 'Yellow', 'Green', 'Black', 'Purple', 'White'];
const isDigimon = (c: DigiCard) => c.type === 'Digimon' || (c.type === 'Dual' && c.level != null);
const group = (c: DigiCard) => (c.type === 'Digi-Egg' ? 'Digi-Eggs' : isDigimon(c) ? `Level ${c.level ?? '?'}` : c.type === 'Tamer' ? 'Tamers' : 'Options');

export const game: GameDef<DigiCard> = {
  id: 'digimon',
  title: "Milk's Digimon Deck Builder",
  game: 'Digimon Card Game',
  formats,
  zoneFor: (c) => (c.type === 'Digi-Egg' ? 'egg' : 'main'),
  maxCopies,
  illegal: (c, f) => illegal(c, f),
  validate,

  label,
  group,
  groups: ['Digi-Eggs', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Tamers', 'Options'],
  cost: (c) => (c.type === 'Digi-Egg' ? null : c.playCost),
  image: (c) => ({ src: `https://images.digimoncard.io/images/cards/${c.id}.webp` }),
  details: (c) => {
    const rows: [string, string][] = [['Type', c.type + (c.form ? ` · ${c.form}` : '')]];
    rows.push(['Color', c.colors.join(' / ') || '—']);
    if (c.level != null) rows.push(['Level', String(c.level)]);
    if (c.playCost != null) rows.push(['Play cost', String(c.playCost)]);
    if (c.digiCost != null) rows.push(['Digivolve', `${c.digiCost}${c.digiFrom ? ` from ${c.digiFrom}` : ''}`]);
    if (c.dp != null) rows.push(['DP', c.dp.toLocaleString()]);
    if (c.attribute) rows.push(['Attribute', c.attribute]);
    if (c.traits.length) rows.push(['Traits', c.traits.join(', ')]);
    rows.push(['Card', `${c.id} · ${c.rarity}`]);
    if (RESTRICTED.has(c.id)) rows.push(['Restricted', 'Max 1 per deck']);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => [c.text, c.inherited && `Inherited: ${c.inherited}`, c.special].filter((x): x is string => !!x),
  searchText: (c) => [c.name, c.id, c.type, ...c.colors, c.form, c.attribute, ...c.traits, c.text, c.inherited, c.special].filter(Boolean).join(' ').toLowerCase(),
  filters: [
    { id: 'type', label: 'Type', values: (c) => [c.type], options: ['Digi-Egg', 'Digimon', 'Tamer', 'Option', 'Dual'] },
    { id: 'color', label: 'Color', values: (c) => c.colors, options: COLORS },
    { id: 'level', label: 'Level', values: (c) => (c.level != null ? [`Lv.${c.level}`] : []), options: ['Lv.2', 'Lv.3', 'Lv.4', 'Lv.5', 'Lv.6', 'Lv.7'] },
    { id: 'cost', label: 'Cost', values: (c) => (c.playCost == null ? [] : [c.playCost >= 10 ? '10+' : String(c.playCost)]), options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'] },
    { id: 'rarity', label: 'Rarity', values: (c) => [c.rarity], options: ['C', 'U', 'R', 'SR', 'SEC', 'P'] },
    { id: 'set', label: 'Set', values: (c) => [c.set] },
  ],
  stats: ['color', 'level', 'type'],

  goldfish: {
    hand: 5,
    mulligans: 1,
    draw: 1,
    turn: 'Turn',
    stack: { name: 'Security', count: 5 },
    side: { zone: 'egg', name: 'Digi-Egg deck', action: 'Hatch', into: 'breeding area' },
    zones: ['main'],
    note: 'Draw 5 and mulligan once if you like; 5 security cards are dealt when turn 1 starts. Going first skips the turn 1 draw.',
    odds: [
      { label: 'Level 3 Digimon', test: (c) => isDigimon(c) && c.level === 3 },
      { label: 'Level 4 Digimon', test: (c) => isDigimon(c) && c.level === 4 },
      { label: 'Tamer', test: (c) => c.type === 'Tamer' },
      { label: 'Option', test: (c) => c.type === 'Option' },
    ],
  },

  importHint: 'Paste a list with card numbers ("4 Agumon BT1-010" per line), or Tabletop Simulator JSON from digimoncard.io / DigimonMeta.',
  exportLabel: 'Copy decklist (with card numbers)',
  exportDeck,
  importDeck,
  tcgProductLine: 'Digimon Card Game',
};
