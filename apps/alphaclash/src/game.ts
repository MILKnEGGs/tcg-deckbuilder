// Alpha Clash for the shared deck builder: Constructed (Comprehensive Rulebook 8.0 and the Season ban
// lists) and Casual (the same deck rules without bans).
//
// Deck rules (rule 100.2): one Contender; a Main Deck of 50–60 cards; a Sideboard of 0–15; at most 4 cards
// of any English name; at most 4 Clash Buffs; either one Unrivaled card or up to 4 copies of one Rivaled
// card, never both; and cards with a deck building restriction (names or role symbols in brackets at the top
// of the text, "[(Destroyer)]/[Khagan]") only if the Contender matches one of them. All of these count the
// Main Deck and Sideboard together. A Contender with Affinity (Entropy) allows one copy of cards that don't
// share its quality.
//
// TCGplayer's data has no role symbols, so the deck's Contender role is a per-deck option; restrictions that
// need a role are only warnings until it's set.

import { listNamer, parseTextDeck, taggedCard } from '@milk/core/import';
import { exactZone, legalityIssues, misplaced, unknownCards, zoneLimit } from '@milk/core/rules';
import { zoneCount } from '@milk/core/deck';
import type { Badge, Card, CardIndex, Deck, Entry, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { localDay, money, plural } from '@milk/core/util';

export interface AcCard extends Card {
  type: 'Contender' | 'Clash' | 'Accessory' | 'Action' | 'Clashground' | string;
  /** Relic, Trap, Weapon, Contender Weapon; Basic, Quick, Clash Buff, Empowerment. */
  subtypes?: string[];
  colors: string[];
  /** Initial resource cost; null for Contenders (and a few cards TCGplayer leaves blank). */
  cost: number | null;
  /** Specific resource cost as gem letters, e.g. "BB" (B black, G green, W white, U blue, R red). */
  gems: string;
  attack: number | null;
  defense: number | null;
  /** A Contender's starting health (from DeckPlanet). */
  health?: number;
  /** The card's current wording where it has errata (from DeckPlanet). */
  errata?: string;
  /** The bracketed character name ("Moxie"). */
  character?: string;
  planet?: string;
  location?: string;
  affiliations: string[];
  /** Deck building keywords found in the text: Unrivaled, Rivaled, Exclusive. */
  keywords: string[];
  /** Deck building restriction: the Contender must match one of these names, colors or symbols. */
  restriction?: string[];
  text?: string;
  rarity: string;
  set: string;
  sets: string[];
  img: number;
  /** A two-sided Contender's other side. */
  back?: { name: string; text?: string; colors: string[]; attack: number | null; defense: number | null; health?: number; img: number };
}

export const ROLES = ['Destroyer', 'Savior', 'Sentinel'];
export const COLORS = ['Black', 'Blue', 'Green', 'Red', 'White', 'Colorless'];

const zones = () => [
  { id: 'contender', name: 'Contender', max: 1, command: true },
  { id: 'main', name: 'Main Deck', max: 100 },
  { id: 'side', name: 'Sideboard', max: 30, placeholders: 0 },
];

export const formats: FormatDef[] = [
  {
    id: 'constructed',
    name: 'Constructed',
    summary: '1 Contender, 50–60 cards, up to 4 of each, 0–15 sideboard. The current ban list applies',
    zones: zones(),
    size: { zones: ['main'], target: 50 },
    recommended: true,
  },
  {
    id: 'casual',
    name: 'Casual',
    summary: 'Constructed deck rules with no bans or limits, for kitchen-table games',
    zones: zones(),
    size: { zones: ['main'], target: 50 },
  },
];

// ---------------------------------------------------------------------------------------------
// Ban lists. Rulebook 8.0 Appendix B until Seasons start; each Season's list replaces the one before.
// Source: alphaclashtcg.com/play/ban-errata and "Seasons Are Coming" (October 30, 2026).

interface Season {
  name: string;
  from: string;
  banned: string[];
  /** Most copies allowed (Limited (X)). */
  limited: Record<string, number>;
  /** Restrictions added by errata, by card name. */
  restrict: Record<string, string[]>;
}

export const SEASONS: Season[] = [
  {
    name: 'Rulebook 8.0',
    from: '2000-01-01',
    banned: ['Energy Explosion', 'Incoming Support', 'Morale Boost', 'Power Overflowing', 'Streaks Inbound'],
    limited: {},
    restrict: {},
  },
  {
    name: 'Season 1',
    from: '2027-01-01',
    banned: ['Energy Explosion', 'Morale Boost', 'Power Overflowing', 'Streaks Inbound', 'Zhao Li, Reconnaissance Agent', 'Morac, the Devourer'],
    limited: { Denver: 1, 'The Absence, Shadow Incarnate': 1, 'Pestilence, the Infectious': 2 },
    restrict: { 'Lord Krung, Ruthless Warlord': ['Discarded'] },
  },
];

export function seasonOn(day = localDay()): Season {
  return [...SEASONS].reverse().find((s) => s.from <= day) ?? SEASONS[0];
}
const official = (format: FormatDef) => format.id === 'constructed';

export function illegal(card: AcCard, format: FormatDef, day = localDay()): string | null {
  if (official(format) && seasonOn(day).banned.includes(card.name)) return `banned (${seasonOn(day).name})`;
  if (card.released && card.released > day) return 'not released yet';
  return null;
}

/** The card's restriction, with any the Season's errata adds. */
export function restrictionOf(card: AcCard, format: FormatDef, day = localDay()): string[] | undefined {
  const extra = official(format) ? seasonOn(day).restrict[card.name] : undefined;
  return extra ? [...(card.restriction ?? []), ...extra] : card.restriction;
}

// ---------------------------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
const contenderOf = (deck: Deck, cards: CardIndex<AcCard>) => {
  const e = deck.zones.contender?.[0];
  return e ? cards.get(e.id) : undefined;
};
export const roleOf = (deck: Deck): string | undefined => deck.options?.role || undefined;

/** Everything a restriction can name about the Contender: names, colors, affiliations, planet, role. */
function contenderTraits(ch: AcCard, role?: string): Set<string> {
  const names = [ch.name, ch.name.split(',')[0], ch.character, ch.back?.name, ch.back?.name.split(',')[0]];
  return new Set(
    [...names, ...ch.colors, ...(ch.back?.colors ?? []), ...ch.affiliations, ch.planet, role].filter((s): s is string => !!s).map(norm),
  );
}

/**
 * Whether the Contender allows this card: 'ok', 'no', or 'role' when only an unset role could allow it.
 */
export function restrictionFit(card: AcCard, ch: AcCard | undefined, role: string | undefined, format: FormatDef, day = localDay()): 'ok' | 'no' | 'role' {
  const need = restrictionOf(card, format, day);
  if (!need?.length || card.type === 'Contender') return 'ok';
  if (!ch) return 'role';
  const traits = contenderTraits(ch, role);
  if (need.some((n) => traits.has(norm(n)))) return 'ok';
  return !role && need.some((n) => ROLES.includes(cap(n))) ? 'role' : 'no';
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const fmtNeed = (need: string[]) => need.map((n) => (ROLES.includes(cap(n)) ? cap(n) : n)).join(' or ');

/** Affinity qualities on the Contender ("Affinity: Colorless"). */
export function affinityOf(ch: AcCard | undefined): string[] {
  const out: string[] = [];
  for (const m of (ch?.text ?? '').matchAll(/Affinity\s*:\s*([A-Za-z -]+?)(?=[\n.,(]|$)/g)) out.push(m[1].trim());
  return out;
}
const hasQuality = (c: AcCard, q: string) => {
  const n = norm(q);
  return [...c.colors, c.type, ...(c.subtypes ?? []), ...c.affiliations].some((v) => norm(v) === n);
};

const isBuff = (c: AcCard) => !!c.subtypes?.includes('Clash Buff');
const unrivaled = (c: AcCard) => c.keywords.includes('Unrivaled');
const rivaled = (c: AcCard) => c.keywords.includes('Rivaled');

export function maxCopies(card: AcCard, format: FormatDef, deck?: Deck, cards?: CardIndex<AcCard>, day = localDay()): number {
  if (card.type === 'Contender') return 1;
  if (unrivaled(card)) return 1;
  let max = 4;
  const limit = official(format) ? seasonOn(day).limited[card.name] : undefined;
  if (limit != null) max = Math.min(max, limit);
  const affinity = deck && cards ? affinityOf(contenderOf(deck, cards)) : [];
  if (affinity.length && !affinity.some((q) => hasQuality(card, q))) max = Math.min(max, 1);
  return max;
}

// ---------------------------------------------------------------------------------------------

function entries(deck: Deck, cards: CardIndex<AcCard>): { e: Entry; c: AcCard }[] {
  return ['main', 'side'].flatMap((z) => (deck.zones[z] ?? []).map((e) => ({ e, c: cards.get(e.id)! })).filter((x) => x.c));
}

function sizeIssues(deck: Deck): Issue[] {
  const n = zoneCount(deck, 'main');
  if (n < 50) return [{ level: 'error', message: `${n}/50 cards: add ${50 - n} more` }];
  if (n > 60) return [{ level: 'error', message: `${n} cards: the Main Deck holds 50–60. Cut ${n - 60}` }];
  return [];
}

function copyIssues(deck: Deck, cards: CardIndex<AcCard>, format: FormatDef): Issue[] {
  const byName = new Map<string, { c: AcCard; n: number }>();
  for (const { e, c } of entries(deck, cards)) {
    const x = byName.get(c.name) ?? byName.set(c.name, { c, n: 0 }).get(c.name)!;
    x.n += e.qty;
  }
  const issues: Issue[] = [];
  for (const { c, n } of byName.values()) {
    const max = maxCopies(c, format, deck, cards);
    if (n > max) {
      const why = unrivaled(c) ? ' (Unrivaled)' : max < 4 && official(format) && seasonOn().limited[c.name] != null ? ` (Limited in ${seasonOn().name})` : max === 1 ? ' (Affinity)' : '';
      issues.push({ level: 'error', message: `${c.name}: ${n} copies, max ${max}${why}`, cards: [c.id] });
    }
  }
  return issues;
}

function keywordIssues(deck: Deck, cards: CardIndex<AcCard>): Issue[] {
  const list = entries(deck, cards);
  const issues: Issue[] = [];
  const un = list.filter((x) => unrivaled(x.c));
  const unCount = un.reduce((n, x) => n + x.e.qty, 0);
  if (unCount > 1)
    issues.push({ level: 'error', message: `${unCount} Unrivaled cards: a deck may have only one (${un.map((x) => x.c.name).join(', ')})`, cards: un.map((x) => x.c.id) });
  const riv = list.filter((x) => rivaled(x.c));
  const rivNames = [...new Set(riv.map((x) => x.c.name))];
  if (rivNames.length > 1)
    issues.push({ level: 'error', message: `Rivaled cards with different names: ${rivNames.join(', ')}. Pick one`, cards: riv.map((x) => x.c.id) });
  if (un.length && riv.length)
    issues.push({ level: 'error', message: `Unrivaled and Rivaled cards can't share a deck: ${[...un, ...riv].map((x) => x.c.name).join(', ')}`, cards: [...un, ...riv].map((x) => x.c.id) });
  const buffs = list.filter((x) => isBuff(x.c));
  const buffCount = buffs.reduce((n, x) => n + x.e.qty, 0);
  if (buffCount > 4) issues.push({ level: 'error', message: `${buffCount} Clash Buffs: max 4 (Main Deck and Sideboard together)`, cards: buffs.map((x) => x.c.id) });
  return issues;
}

function restrictionIssues(deck: Deck, cards: CardIndex<AcCard>, format: FormatDef): Issue[] {
  const ch = contenderOf(deck, cards);
  if (!ch) return [];
  const role = roleOf(deck);
  const bad: AcCard[] = [];
  const unsure: AcCard[] = [];
  for (const { c } of entries(deck, cards)) {
    const fit = restrictionFit(c, ch, role, format);
    if (fit === 'no' && !bad.includes(c)) bad.push(c);
    if (fit === 'role' && !unsure.includes(c)) unsure.push(c);
  }
  const issues: Issue[] = [];
  if (bad.length)
    issues.push({
      level: 'error',
      message: `${ch.name}${role ? ` (${role})` : ''} can't include: ${bad.map((c) => `${c.name} [${fmtNeed(restrictionOf(c, format)!)}]`).join(', ')}`,
      cards: bad.map((c) => c.id),
    });
  if (unsure.length)
    issues.push({
      level: 'warning',
      message: `Set your Contender's role (top of the deck) to check: ${unsure.map((c) => `${c.name} [${fmtNeed(restrictionOf(c, format)!)}]`).join(', ')}`,
      cards: unsure.map((c) => c.id),
    });
  return issues;
}

function validate(deck: Deck, cards: CardIndex<AcCard>, format: FormatDef): Issue[] {
  return [
    ...exactZone(deck, 'contender', 1, 'Contender'),
    ...sizeIssues(deck),
    ...zoneLimit(deck, 'side', 15, 'Sideboard'),
    ...restrictionIssues(deck, cards, format),
    ...keywordIssues(deck, cards),
    ...legalityIssues(game, deck, cards, format),
    ...copyIssues(deck, cards, format),
    ...misplaced(game, deck, cards, format),
    ...unknownCards(deck, cards),
  ];
}

// ---------------------------------------------------------------------------------------------
// Decklists: plain text with Contender, Main Deck and Sideboard headings.

function exportDeck(deck: Deck, cards: CardIndex<AcCard>): string {
  const name = listNamer(cards, (c) => c.name);
  const section = (title: string, list: Entry[] = []) =>
    list.length ? [title, ...list.map((e) => `${e.qty} ${cards.get(e.id) ? name(cards.get(e.id)!) : `[${e.id}]`}`)].join('\n') : '';
  return [section('Contender', deck.zones.contender), section('Main Deck', deck.zones.main), section('Sideboard', deck.zones.side)]
    .filter(Boolean)
    .join('\n\n');
}

function importDeck(text: string, cards: CardIndex<AcCard>, all: FormatDef[]): Imported {
  // A card number alone ("4 AC1-071" or "4 Name AC1-071") names that card.
  const fixed = text
    .split(/\r?\n/)
    .map((line) => {
      const m = /\b([A-Z]{1,4}\d{0,2}-[A-Z]?\d{2,3}[a-z]?)\b\s*(?:\([^)]*\))?\s*$/i.exec(line.trim());
      if (!m || taggedCard(line, cards)) return line;
      const c = cards.get(m[1].toUpperCase());
      return c ? `${line.slice(0, line.lastIndexOf(m[1])).replace(/[[(\s]+$/, '')} [${c.id}]` : line;
    })
    .join('\n');
  return { ...parseTextDeck(game, fixed, cards, all[0]), format: 'constructed' };
}

// ---------------------------------------------------------------------------------------------

const COLOR_STYLE: Record<string, { text: string; color: string }> = {
  Black: { text: 'B', color: '#a1a1aa' },
  Blue: { text: 'U', color: '#3b82f6' },
  Green: { text: 'G', color: '#22c55e' },
  Red: { text: 'R', color: '#ef4444' },
  White: { text: 'W', color: '#f5f5f4' },
  Colorless: { text: 'C', color: '#94a3b8' },
};
const GEM_NAME: Record<string, string> = { B: 'Black', G: 'Green', W: 'White', U: 'Blue', R: 'Red' };
const costText = (c: AcCard) => (c.cost == null ? null : `${c.cost}${c.gems ? ` (${[...c.gems].map((g) => GEM_NAME[g]?.[0] ?? g).join('')})` : ''}`);
const groupOf = (c: AcCard) =>
  c.type === 'Contender' ? 'Contender' : c.type === 'Clash' ? 'Clash Cards' : c.type === 'Clashground' ? 'Clashgrounds' : c.type === 'Accessory' ? 'Accessories' : 'Actions';

export const game: GameDef<AcCard> = {
  id: 'alphaclash',
  title: "Milk's Alpha Clash Deck Builder",
  game: 'Alpha Clash',
  formats,
  zoneFor: (c) => (c.type === 'Contender' ? 'contender' : 'main'),
  maxCopies: (c, f, deck, cards) => maxCopies(c, f, deck, cards),
  illegal: (c, f) => illegal(c, f),
  validate,

  label: (c) => c.name,
  setCode: (c) => c.set,
  group: groupOf,
  groups: ['Contender', 'Clash Cards', 'Accessories', 'Actions', 'Clashgrounds'],
  cost: (c) => c.cost,
  image: (c) => ({
    src: `https://tcgplayer-cdn.tcgplayer.com/product/${c.img}_400w.jpg`,
    back: c.back ? `https://tcgplayer-cdn.tcgplayer.com/product/${c.back.img}_400w.jpg` : undefined,
  }),
  qtyLabel: () => null,
  badges: (c): Badge[] => [
    ...c.colors.map((col) => ({ text: COLOR_STYLE[col]?.text ?? col[0], title: col, color: COLOR_STYLE[col]?.color })),
    ...(unrivaled(c) ? [{ text: '1', title: 'Unrivaled: one per deck', color: '#facc15', square: true }] : []),
    ...(rivaled(c) ? [{ text: 'R', title: 'Rivaled', color: '#fb923c', square: true }] : []),
    ...(c.restriction ? [{ text: '[ ]', title: `Only for: ${fmtNeed(c.restriction)}`, color: '#c084fc', square: true }] : []),
  ],
  details: (c) => {
    const rows: [string, string][] = [['Type', [c.type, ...(c.subtypes ?? [])].join(' · ')]];
    rows.push(['Color', c.colors.join(' / ') || '—']);
    if (c.cost != null) rows.push(['Cost', costText(c)!]);
    if (c.attack != null || c.defense != null) rows.push(['Attack / defense', `${c.attack ?? '–'} / ${c.defense ?? '–'}`]);
    if (c.health != null) rows.push(['Health', c.back?.health != null && c.back.health !== c.health ? `${c.health} (other side ${c.back.health})` : String(c.health)]);
    if (c.character) rows.push(['Character', c.character]);
    if (c.affiliations.length) rows.push(['Affiliation', c.affiliations.join(', ')]);
    if (c.planet) rows.push(['Planet', c.planet]);
    if (c.location) rows.push(['Location', c.location]);
    if (c.restriction) rows.push(['Deck restriction', `Contender must be ${fmtNeed(c.restriction)}`]);
    if (c.keywords.length) rows.push(['Deck building', c.keywords.join(', ')]);
    if (c.back) rows.push(['Other side', `${c.back.name} (${c.back.colors.join(' / ')})`]);
    rows.push(['Set', `${c.sets.join(', ')} · ${c.rarity}`]);
    const s = seasonOn();
    if (s.banned.includes(c.name)) rows.push(['Constructed', `Banned (${s.name})`]);
    else if (s.limited[c.name] != null) rows.push(['Constructed', `Limited to ${s.limited[c.name]} (${s.name})`]);
    const next = SEASONS.find((x) => x.from > localDay());
    if (next && next.banned.includes(c.name) !== s.banned.includes(c.name))
      rows.push([next.name, next.banned.includes(c.name) ? `Banned from ${next.from}` : `Unbanned from ${next.from}`]);
    else if (next && next.limited[c.name] != null) rows.push([next.name, `Limited to ${next.limited[c.name]} from ${next.from}`]);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => [
    ...(c.text ? [c.text] : []),
    ...(c.errata ? [`Errata (current wording): ${c.errata}`] : []),
    ...(c.back?.text ? [`Other side: ${c.back.name}\n${c.back.text}`] : []),
  ],
  searchText: (c) =>
    [c.name, c.id, ...(c.alt ?? []), c.type, ...(c.subtypes ?? []), ...c.colors, c.character, c.planet, c.location, ...c.affiliations, ...c.keywords, c.text, c.errata, c.back?.name, c.back?.text, ...c.sets]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  filters: [
    { id: 'color', label: 'Color', values: (c) => c.colors, options: COLORS },
    { id: 'type', label: 'Type', values: (c) => [c.type], options: ['Contender', 'Clash', 'Accessory', 'Action', 'Clashground'] },
    { id: 'subtype', label: 'Subtype', values: (c) => c.subtypes ?? [] },
    { id: 'cost', label: 'Cost', values: (c) => (c.cost == null ? [] : [c.cost >= 7 ? '7+' : String(c.cost)]), options: ['0', '1', '2', '3', '4', '5', '6', '7+'] },
    { id: 'affiliation', label: 'Affiliation', values: (c) => c.affiliations },
    { id: 'character', label: 'Character', values: (c) => (c.character ? [c.character] : []), minCards: 3 },
    { id: 'planet', label: 'Planet', values: (c) => (c.planet ? [c.planet] : []) },
    { id: 'restriction', label: 'Restricted to', values: (c) => (c.restriction ?? []).map((n) => (ROLES.includes(cap(n)) ? cap(n) : n)), minCards: 2 },
    { id: 'set', label: 'Set', values: (c) => c.sets },
  ],
  stats: ['color', 'type'],

  deckOptions: [
    {
      id: 'role',
      label: 'Contender role',
      // Only asked once there's a Contender; the hint says how many cards in the deck need each role.
      choices: (deck, cards) => {
        if (!contenderOf(deck, cards)) return [];
        const list = entries(deck, cards);
        return ROLES.map((r) => {
          const n = list.filter((x) => x.c.restriction?.some((q) => cap(q) === r)).length;
          return { value: r, label: r, hint: n ? `${plural(n, 'card')} ${n === 1 ? 'needs' : 'need'} it` : undefined };
        });
      },
      auto: () => null,
      none: 'Not set',
    },
  ],

  fit: {
    label: 'Fits my Contender',
    miss: (c, deck, cards) => {
      const fit = restrictionFit(c, contenderOf(deck, cards), roleOf(deck), formats.find((f) => f.id === deck.format) ?? formats[0]);
      const need = c.restriction ? fmtNeed(c.restriction) : '';
      return fit === 'no' ? `Needs ${need}` : fit === 'role' ? `Needs ${need} (set role)` : null;
    },
    test: (c, deck, cards, format) => c.type !== 'Contender' && restrictionFit(c, contenderOf(deck, cards), roleOf(deck), format) !== 'no',
  },

  goldfish: {
    hand: 8,
    mulligans: 1,
    draw: 1,
    turn: 'Turn',
    resources: { setup: 0, perTurn: 1, firstTurn: true, action: 'Resource', pile: 'Resource Zone' },
    canResource: (c) => !rivaled(c),
    zones: ['main'],
    note: 'Draw 8; you may mulligan once by shuffling any cards back and drawing that many. Each turn you may put one card into your Resource Zone. Going first skips the turn 1 draw.',
    odds: [
      { label: 'Cost 1–2 card', test: (c) => c.cost != null && c.cost <= 2 },
      { label: 'Clash card', test: (c) => c.type === 'Clash' },
      { label: 'Clashground', test: (c) => c.type === 'Clashground' },
      { label: 'Clash Buff', test: isBuff },
    ],
  },

  importHint: 'Paste a list like "4 Mean-Streak, Ready to Brawl" per line (card numbers like "4 AC1-071" work too), with Contender and Sideboard headings.',
  exportLabel: 'Copy decklist (text)',
  exportDeck,
  importDeck,
  tcgProductLine: 'Alpha Clash',
  massEntryById: true,
};
