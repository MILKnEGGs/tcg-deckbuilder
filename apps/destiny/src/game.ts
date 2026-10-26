// Star Wars: Destiny for the shared deck builder, following the A Renewed Hope (ARH) Rules Reference
// v1.07.01. A deck is three parts:
//  - a team: up to 30 points of characters (a unique character's second point value buys a second
//    die, "elite"; non-unique characters can be taken several times) plus at most one plot. Heroes and
//    villains can't share a team;
//  - exactly 30 deck cards, at most 2 of each (or the card's own limit). Hero/villain cards need a team
//    character of that affiliation; Red/Blue/Yellow cards need a team character of that color;
//  - one battlefield.
// Formats (legal sets, bans, restricted list and pairs, point changes) come from the ARH database with
// the card data, so they stay current without code changes.
//
// In the team zone an entry's quantity is its dice: a unique character with qty 2 is elite.

import { listNamer, parseTextDeck } from '@milk/core/import';
import { exactZone, legalityIssues, misplaced, sizeIssues, unknownCards } from '@milk/core/rules';
import type { Badge, Card, CardIndex, Deck, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

export interface SwdCard extends Card {
  sub?: string;
  type: 'character' | 'plot' | 'battlefield' | 'event' | 'upgrade' | 'support' | 'downgrade' | string;
  affiliation: 'hero' | 'villain' | 'neutral';
  color: 'red' | 'blue' | 'yellow' | 'gray';
  subtypes: string[];
  unique: boolean;
  /** Team points: "12/16" (one die / elite), "7", or a plot's "-1". */
  points?: string;
  cost: number | null;
  health: number | null;
  /** Die faces, e.g. ["1RD", "2RD", "1F", "1Dc", "1R", "-"]. */
  sides?: string[];
  text?: string;
  /** Most copies in a deck (usually 2). */
  limit: number;
  rarity: string;
  set: string;
  sets: string[];
  released?: string;
  /** Not sold: free print-and-play from the community (ARH) sets, or from Fantasy Flight when `ffg`. */
  pnp?: true;
  /** Fantasy Flight's own print-and-play (Transformations). */
  ffg?: true;
  /** The other side of a double-sided card. */
  back?: { name: string; sub?: string; type: string; img: string; text?: string };
  flip?: true;
  img: string;
  /** Per-format rules, by format code. */
  legal: string[];
  banned?: string[];
  restricted?: string[];
  balance?: Record<string, string>;
  pairs?: Record<string, string[]>;
}

const zones = () => [
  { id: 'team', name: 'Characters', max: 12, command: true, placeholders: 1 },
  { id: 'plot', name: 'Plot', max: 1, command: true },
  { id: 'battlefield', name: 'Battlefield', max: 1, command: true },
  { id: 'main', name: 'Deck', max: 60 },
];
const fmt = (id: string, name: string, summary: string): FormatDef => ({ id, name, summary, zones: zones(), size: { zones: ['main'], target: 30, exact: true } });

export const formats: FormatDef[] = [
  { ...fmt('FFGInf', 'FFG Infinite', 'Every official Fantasy Flight set'), recommended: true },
  fmt('ARHS', 'ARH Standard', 'The current community format: A Renewed Hope sets from Echoes of Destiny on'),
  fmt('INF', 'Galactic Infinite', 'Every set, official and community'),
  fmt('STD', 'FFG Standard', "Fantasy Flight's last official Standard (Legacies to Transformations)"),
  fmt('TRI', 'FFG Trilogy', "Fantasy Flight's Trilogy (Convergence to Covert Missions)"),
];

const MAX_POINTS = 30;
const COLORS = ['red', 'blue', 'yellow', 'gray'] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (c: SwdCard) => (c.sub ? `${c.name}, ${c.sub}` : c.name);

// ---------------------------------------------------------------------------------------------
// Points

/** A card's point values in a format, with the format's balance changes applied. */
export function pointValues(card: SwdCard, format: FormatDef): number[] {
  const s = card.balance?.[format.id] ?? card.points;
  return s ? s.split('/').map((x) => Number(x.trim())).filter((n) => !isNaN(n)) : [];
}

/** Points for `qty` of a card on the team: dice for a unique character, copies otherwise. */
export function teamPoints(card: SwdCard, qty: number, format: FormatDef): number {
  const v = pointValues(card, format);
  if (!v.length) return 0;
  if (card.unique) return v[Math.min(qty, v.length) - 1];
  return v[0] * qty;
}

export function pointsUsed(deck: Deck, cards: CardIndex<SwdCard>, format: FormatDef): number {
  let total = 0;
  for (const z of ['team', 'plot'])
    for (const e of deck.zones[z] ?? []) {
      const c = cards.get(e.id);
      if (c) total += teamPoints(c, e.qty, format);
    }
  return total;
}

// ---------------------------------------------------------------------------------------------
// What the team allows in the deck

/** Exceptions printed on team cards: "You can include up to 5 Yellow villain cards in your deck." */
interface IncludeRule {
  source: string;
  limit: number | null;
  colors: string[];
  affiliations: string[];
  types: string[];
  subtypes: string[];
  /** "ignoring affiliation and color" (Cassian Andor); otherwise only affiliation is waived. */
  waiveColor: boolean;
}
const TYPE_WORDS = new Set(['event', 'upgrade', 'support', 'downgrade']);
const SKIP_WORDS = new Set(['card', 'cards', 'and', 'or', 'a', 'any', 'the', 'non-unique', 'unique', 'of', 'different']);
const singular = (w: string) => w.replace(/ies$/, 'y').replace(/s$/, '');

export function includeRules(teamCards: SwdCard[]): { rules: IncludeRule[]; unread: SwdCard[] } {
  const rules: IncludeRule[] = [];
  const unread: SwdCard[] = [];
  for (const c of teamCards) {
    for (const m of (c.text ?? '').matchAll(/You can include (.+?) in your deck([^.]*)/gi)) {
      const phrase = m[1];
      // A card's own copy limit is already in the data ("up to 4 copies of this support").
      if (/copies of this/i.test(phrase)) continue;
      // Extra copies of other cards (Double Down) is a different kind of rule: flag it.
      if (/additional cop/i.test(phrase)) {
        unread.push(c);
        continue;
      }
      const waiveColor = /ignoring[^.]*colou?r/i.test(m[2]);
      // "up to 2 villain cards and up to 2 hero cards" is two rules.
      for (const part of phrase.split(/\s+and (?=up to \d)/i)) {
        const lim = /^up to (\d+)\s+/i.exec(part);
        const words = part.replace(/^up to \d+\s+/i, '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
        const rule: IncludeRule = { source: c.name, limit: lim ? Number(lim[1]) : null, colors: [], affiliations: [], types: [], subtypes: [], waiveColor };
        for (const w of words) {
          const s = singular(w);
          if ((COLORS as readonly string[]).includes(s)) rule.colors.push(s);
          else if (s === 'hero' || s === 'villain') rule.affiliations.push(s);
          else if (TYPE_WORDS.has(s)) rule.types.push(s);
          else if (!SKIP_WORDS.has(w)) rule.subtypes.push(s);
        }
        if (!rule.colors.length && !rule.affiliations.length && !rule.types.length && !rule.subtypes.length) unread.push(c);
        else rules.push(rule);
      }
    }
  }
  return { rules, unread };
}

const ruleMatches = (r: IncludeRule, c: SwdCard) =>
  (!r.colors.length || r.colors.includes(c.color)) &&
  (!r.affiliations.length || r.affiliations.includes(c.affiliation)) &&
  (!r.types.length || r.types.includes(c.type)) &&
  (!r.subtypes.length || r.subtypes.some((s) => c.subtypes.includes(s)));

const teamOf = (deck: Deck, cards: CardIndex<SwdCard>) => (deck.zones.team ?? []).map((e) => cards.get(e.id)).filter((c): c is SwdCard => !!c);

const affOk = (card: SwdCard, team: SwdCard[]) => card.affiliation === 'neutral' || team.some((t) => t.affiliation === card.affiliation);
const colorOk = (card: SwdCard, team: SwdCard[]) => card.color === 'gray' || team.some((t) => t.color === card.color);

/** Whether the team's affiliations and colors allow a deck card (before printed exceptions). */
export const normallyAllowed = (card: SwdCard, team: SwdCard[]) => affOk(card, team) && colorOk(card, team);

/** The printed exception that lets an otherwise-disallowed card in, if any. */
export const exceptionFor = (card: SwdCard, team: SwdCard[], rules: IncludeRule[]) =>
  rules.find((r) => ruleMatches(r, card) && (r.waiveColor || colorOk(card, team)));

function deckRuleIssues(deck: Deck, cards: CardIndex<SwdCard>): Issue[] {
  const team = teamOf(deck, cards);
  if (!team.length) return [];
  const issues: Issue[] = [];
  const plot = cards.get(deck.zones.plot?.[0]?.id ?? '');
  const { rules, unread } = includeRules(plot ? [...team, plot] : team);
  const used = new Map<IncludeRule, number>();
  const off: SwdCard[] = [];
  for (const e of deck.zones.main ?? []) {
    const c = cards.get(e.id);
    if (!c || normallyAllowed(c, team)) continue;
    const rule = exceptionFor(c, team, rules);
    if (rule) used.set(rule, (used.get(rule) ?? 0) + e.qty);
    else off.push(c);
  }
  if (off.length) {
    const why = (c: SwdCard) => (!affOk(c, team) ? `${c.name} (${c.affiliation})` : `${c.name} (${c.color})`);
    issues.push({ level: 'error', message: `Your team can't include: ${off.slice(0, 8).map(why).join(', ')}${off.length > 8 ? ` and ${off.length - 8} more` : ''}`, cards: off.map((c) => c.id) });
  }
  for (const [r, n] of used)
    if (r.limit != null && n > r.limit) issues.push({ level: 'error', message: `${r.source} allows up to ${r.limit} of those cards; the deck has ${n}` });
  if (unread.length)
    issues.push({ level: 'warning', message: `Check the deck-building ability of ${unread.map((c) => c.name).join(', ')}; the app couldn't read it`, cards: unread.map((c) => c.id) });
  return issues;
}

function teamIssues(deck: Deck, cards: CardIndex<SwdCard>, format: FormatDef): Issue[] {
  const issues: Issue[] = [];
  const team = teamOf(deck, cards);
  if (!team.length) issues.push({ level: 'error', message: 'Choose at least one character' });
  const nonChar = team.filter((c) => c.type !== 'character');
  if (nonChar.length) issues.push({ level: 'error', message: `Only characters go on the team: ${nonChar.map((c) => c.name).join(', ')}`, cards: nonChar.map((c) => c.id) });
  if (team.some((c) => c.affiliation === 'hero') && team.some((c) => c.affiliation === 'villain'))
    issues.push({ level: 'error', message: "Heroes and villains can't be on the same team", cards: team.filter((c) => c.affiliation !== 'neutral').map((c) => c.id) });
  // Same title counts as the same unique character, whatever the subtitle.
  const titles = new Map<string, SwdCard[]>();
  for (const c of team) if (c.unique) (titles.get(c.name) ?? titles.set(c.name, []).get(c.name)!).push(c);
  for (const [name, list] of titles) if (list.length > 1) issues.push({ level: 'error', message: `Only one ${name} can be on a team`, cards: list.map((c) => c.id) });

  const points = pointsUsed(deck, cards, format);
  if (points > MAX_POINTS) issues.push({ level: 'error', message: `Team is ${points}/${MAX_POINTS} points. Cut ${points - MAX_POINTS}` });

  const plot = cards.get(deck.zones.plot?.[0]?.id ?? '');
  if (plot && team.length) {
    if (plot.affiliation !== 'neutral' && !team.some((c) => c.affiliation === plot.affiliation))
      issues.push({ level: 'error', message: `${plot.name} needs a ${plot.affiliation} character`, cards: [plot.id] });
    if (plot.color !== 'gray' && !team.some((c) => c.color === plot.color))
      issues.push({ level: 'error', message: `${plot.name} needs a ${plot.color} character`, cards: [plot.id] });
  }
  return issues;
}

function restrictedIssues(deck: Deck, cards: CardIndex<SwdCard>, format: FormatDef): Issue[] {
  const ids = [...new Set(Object.values(deck.zones).flatMap((l) => l.map((e) => e.id)))];
  const all = ids.map((id) => cards.get(id)).filter((c): c is SwdCard => !!c);
  const issues: Issue[] = [];
  const restricted = all.filter((c) => c.restricted?.includes(format.id));
  if (restricted.length > 1)
    issues.push({ level: 'error', message: `Only one restricted card per deck: ${restricted.map((c) => c.name).join(', ')}`, cards: restricted.map((c) => c.id) });
  const seen = new Set<string>();
  for (const c of all)
    for (const other of c.pairs?.[format.id] ?? []) {
      const key = [c.id, other].sort().join('+');
      if (ids.includes(other) && !seen.has(key)) {
        seen.add(key);
        issues.push({ level: 'error', message: `Restricted pair: ${c.name} and ${cards.get(other)?.name ?? other} can't be in the same deck`, cards: [c.id, other] });
      }
    }
  return issues;
}

function validate(deck: Deck, cards: CardIndex<SwdCard>, format: FormatDef): Issue[] {
  return [
    ...teamIssues(deck, cards, format),
    ...exactZone(deck, 'battlefield', 1, 'battlefield'),
    ...sizeIssues(deck, format),
    ...deckRuleIssues(deck, cards),
    ...legalityIssues(game, deck, cards, format),
    ...restrictedIssues(deck, cards, format),
    ...copyLimitIssues(deck, cards, format),
    ...misplaced(game, deck, cards, format),
    ...unknownCards(deck, cards),
  ];
}

export function maxCopies(card: SwdCard, format: FormatDef): number {
  if (card.type === 'character') return card.unique ? Math.max(1, pointValues(card, format).length) : 12;
  if (card.type === 'plot' || card.type === 'battlefield') return 1;
  return card.limit ?? 2;
}

/** Deck cards over their limit (team characters are covered by points and uniqueness). */
function copyLimitIssues(deck: Deck, cards: CardIndex<SwdCard>, format: FormatDef): Issue[] {
  const issues: Issue[] = [];
  for (const e of deck.zones.main ?? []) {
    const c = cards.get(e.id);
    if (c && e.qty > maxCopies(c, format)) issues.push({ level: 'error', message: `${label(c)}: ${e.qty} copies, max ${maxCopies(c, format)}`, cards: [c.id] });
  }
  return issues;
}

export function illegal(card: SwdCard, format: FormatDef): string | null {
  if (card.banned?.includes(format.id)) return `banned in ${format.name}`;
  if (!card.legal.includes(format.id)) return `not legal in ${format.name}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Dice

const FACE_NAMES: Record<string, string> = {
  RD: 'Ranged',
  MD: 'Melee',
  ID: 'Indirect',
  F: 'Focus',
  Dc: 'Discard',
  Dr: 'Disrupt',
  Sh: 'Shield',
  R: 'Resource',
  Re: 'Resource',
  Sp: 'Special',
};

/** "2RD1" -> "2 Ranged (cost 1)", "+1MD" -> "+1 Melee", "-" -> "Blank". */
export function faceLabel(face: string): string {
  if (face === '-' || !face) return 'Blank';
  const m = /^([+-]?)(\d*)X?([A-Za-z*]+?)i?(\d*)$/.exec(face);
  if (!m) return face;
  const [, sign, value, kind, cost] = m;
  const name = FACE_NAMES[kind] ?? (kind === '*' ? 'Wild' : kind);
  return `${sign}${value}${value || sign ? ' ' : ''}${name}${cost ? ` (cost ${cost})` : ''}`.trim();
}

// ---------------------------------------------------------------------------------------------

const COLOR_STYLE: Record<string, string> = { red: '#ef4444', blue: '#3b82f6', yellow: '#eab308', gray: '#9ca3af' };
const AFF_TEXT: Record<string, string> = { hero: 'H', villain: 'V', neutral: 'N' };
const PLURAL: Record<string, string> = {
  character: 'Characters',
  plot: 'Plots',
  battlefield: 'Battlefields',
  upgrade: 'Upgrades',
  support: 'Supports',
  event: 'Events',
  downgrade: 'Downgrades',
};

function exportDeck(deck: Deck, cards: CardIndex<SwdCard>): string {
  const name = listNamer(cards, label);
  const lines = (zone: string) =>
    (deck.zones[zone] ?? []).map((e) => {
      const c = cards.get(e.id);
      return `${e.qty} ${c ? name(c) : e.id}${zone === 'team' && c?.unique && e.qty > 1 ? '  // elite' : ''}`;
    });
  return [
    ['Characters', ...lines('team')],
    ['Plot', ...lines('plot')],
    ['Battlefield', ...lines('battlefield')],
    ['Deck', ...lines('main')],
  ]
    .filter((p) => p.length > 1)
    .map((p) => p.join('\n'))
    .join('\n\n');
}

function importDeck(text: string, cards: CardIndex<SwdCard>, all: FormatDef[]): Imported {
  return { ...parseTextDeck(game, text, cards, all[0]), format: all[0].id };
}

export const game: GameDef<SwdCard> = {
  id: 'destiny',
  title: "Milk's Destiny Deck Builder",
  game: 'Star Wars: Destiny',
  formats,
  zoneFor: (c) => (c.type === 'character' ? 'team' : c.type === 'plot' ? 'plot' : c.type === 'battlefield' ? 'battlefield' : 'main'),
  maxCopies: (c, f) => maxCopies(c, f),
  illegal: (c, f) => illegal(c, f),
  validate,

  label,
  setCode: (c) => c.set,
  group: (c) => PLURAL[c.type] ?? cap(c.type),
  groups: ['Characters', 'Plots', 'Battlefields', 'Upgrades', 'Supports', 'Events', 'Downgrades'],
  cost: (c) => c.cost,
  image: (c) => ({ src: c.img, back: c.back?.img, landscape: c.type === 'battlefield' }),
  // Upgrades print their name partway down, so label the Deck view's stacks.
  labelStacks: true,
  qtyLabel: (c, qty) => (c.type !== 'character' || qty < 2 ? null : c.unique ? (qty === 2 ? 'Elite' : `${qty} dice`) : `×${qty}`),
  meters: (deck, cards, format) => [{ label: 'team points', value: pointsUsed(deck, cards, format), max: MAX_POINTS }],
  priceNote: (c) => (c.pnp ? 'Print & play' : null),
  badges: (c): Badge[] => {
    const out: Badge[] = [{ text: AFF_TEXT[c.affiliation] ?? '?', title: `${cap(c.affiliation)}, ${cap(c.color)}`, color: COLOR_STYLE[c.color] }];
    if (c.sides) out.push({ text: '🎲', title: 'Has a die', color: '#e5e7eb', square: true });
    return out;
  },
  details: (c) => {
    const rows: [string, string][] = [['Type', cap(c.type) + (c.unique ? ' · Unique' : '')]];
    rows.push(['Side', `${cap(c.affiliation)} · ${cap(c.color)}`]);
    if (c.points) rows.push(['Points', c.points + (c.balance ? ` (format changes: ${Object.entries(c.balance).map(([f, v]) => `${f} ${v}`).join(', ')})` : '')]);
    if (c.cost != null) rows.push(['Cost', String(c.cost)]);
    if (c.health != null) rows.push(['Health', String(c.health)]);
    if (c.sides) rows.push(['Die', c.sides.map(faceLabel).join(' · ')]);
    if (c.subtypes.length) rows.push(['Subtypes', c.subtypes.map(cap).join(', ')]);
    if (c.limit !== 2 && !['character', 'plot', 'battlefield'].includes(c.type)) rows.push(['Deck limit', String(c.limit)]);
    rows.push(['Sets', c.sets.join(', ')]);
    rows.push(['Legal in', c.legal.map((f) => formats.find((x) => x.id === f)?.name ?? f).join(', ') || 'None']);
    if (c.back) rows.push(['Other side', [c.back.name, c.back.sub].filter(Boolean).join(', ') + ` (${c.back.type})`]);
    rows.push(['Price', c.ffg ? 'Print & play (free from Fantasy Flight)' : c.pnp ? 'Print & play (free from swdrenewedhope.com)' : money(c.price)]);
    return rows;
  },
  text: (c) => [...(c.text ? [c.text] : []), ...(c.back?.text ? [`Other side (${c.back.name}): ${c.back.text}`] : [])],
  searchText: (c) =>
    [c.name, c.sub, c.type, c.affiliation, c.color, ...c.subtypes, c.text, ...c.sets, c.back?.name, c.back?.sub, c.back?.text, c.pnp ? 'print and play pnp' : '']
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  filters: [
    { id: 'affiliation', label: 'Side', values: (c) => [cap(c.affiliation)], options: ['Hero', 'Villain', 'Neutral'] },
    { id: 'color', label: 'Color', values: (c) => [cap(c.color)], options: ['Red', 'Blue', 'Yellow', 'Gray'] },
    { id: 'type', label: 'Type', values: (c) => [cap(c.type)], options: ['Character', 'Plot', 'Battlefield', 'Upgrade', 'Support', 'Event', 'Downgrade'] },
    { id: 'dice', label: 'Dice', values: (c) => [c.sides ? 'Has a die' : 'No die'], options: ['Has a die', 'No die'] },
    { id: 'cost', label: 'Cost', values: (c) => (c.cost == null ? [] : [c.cost >= 6 ? '6+' : String(c.cost)]), options: ['0', '1', '2', '3', '4', '5', '6+'] },
    { id: 'set', label: 'Set', values: (c) => c.sets },
    { id: 'source', label: 'Source', values: (c) => [c.ffg ? 'FFG print & play' : c.pnp ? 'Community print & play' : 'Sold (TCGplayer)'], options: ['Sold (TCGplayer)', 'FFG print & play', 'Community print & play'] },
  ],
  stats: ['color', 'type', 'dice'],

  fit: {
    label: 'Fits my team',
    miss: (c, deck, cards) => {
      const team = teamOf(deck, cards);
      if (!team.length || ['character', 'plot', 'battlefield'].includes(c.type) || normallyAllowed(c, team)) return null;
      const { rules } = includeRules(team);
      return exceptionFor(c, team, rules) ? null : "Team can't use";
    },
    test: (c, deck, cards) => {
      const team = teamOf(deck, cards);
      if (!team.length) return true;
      if (c.type === 'character') {
        const side = team.find((t) => t.affiliation !== 'neutral')?.affiliation;
        return !side || c.affiliation === 'neutral' || c.affiliation === side;
      }
      if (c.type === 'battlefield') return true;
      if (normallyAllowed(c, team)) return true;
      return !!exceptionFor(c, team, includeRules(team).rules);
    },
  },

  goldfish: {
    hand: 5,
    refill: true,
    mulligans: 1,
    draw: 0,
    turn: 'Round',
    zones: ['main'],
    counter: { name: 'Resources', first: 2, perTurn: 2, max: 99 },
    dice: (deck, cards) =>
      (deck.zones.team ?? []).flatMap((e) => {
        const c = cards.get(e.id);
        return c?.sides ? Array.from({ length: e.qty }, (_, i) => ({ name: e.qty > 1 ? `${c.name} (${i + 1})` : c.name, faces: c.sides!.map(faceLabel) })) : [];
      }),
    note: 'Draw 5 and mulligan once if you like. Each round you get 2 resources and draw back up to 5. Roll your team’s dice to see an opening roll.',
    odds: [
      { label: 'Card with a die', test: (c) => !!c.sides },
      { label: 'Upgrade', test: (c) => c.type === 'upgrade' },
      { label: 'Event costing 0–1', test: (c) => c.type === 'event' && (c.cost ?? 9) <= 1 },
      { label: 'Support', test: (c) => c.type === 'support' },
    ],
  },

  importHint: 'Paste a list like "2 Leia Organa, Rebel Leader" per line (2 = elite) under Characters, Plot, Battlefield and Deck headings.',
  exportLabel: 'Copy decklist (text)',
  exportDeck,
  importDeck,
  tcgProductLine: 'Star Wars Destiny',
  massEntryById: true,
};
