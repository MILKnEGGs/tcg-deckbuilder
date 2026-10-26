// UniVersus for the shared deck builder: card shape, Standard and Retro formats, and the symbol rules.
//
// Symbols (official Rules Reference v1.2.9): you choose one of your starting character's symbols as the
// deck's primary symbol, and every card must have it, with two exceptions:
//  - Infinity cards go in any deck (an Infinity character picks a primary symbol and has no others);
//  - an attuned symbol (square icon) lets a card in if your character has that symbol, whatever the
//    primary; with several attuned symbols, the character needs any one of them.

import { exactZone, legalityIssues, sizeIssues, unknownCards } from '@milk/core/rules';
import { listNamer, parseTextDeck } from '@milk/core/import';
import type { Badge, Card, CardIndex, Deck, Entry, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

export interface UvsCard extends Card {
  type: 'Character' | 'Attack' | 'Foundation' | 'Action' | 'Asset' | 'Backup' | 'Arena' | string;
  /** Franchise, e.g. "Attack on Titan". */
  ip: string;
  /** Resource symbols, attuned ones included; ["Infinity"] for infinity cards. */
  symbols: string[];
  /** Which of `symbols` are attuned (square icons). */
  attuned?: string[];
  difficulty: number | null;
  check: number | null;
  blockMod?: string;
  blockZone?: string;
  speed: number | null;
  damage?: string;
  attackZone?: string;
  /** Characters: hand size and health. */
  handSize: number | null;
  health: number | null;
  keywords?: string[];
  text?: string;
  rarity: string;
  set: string;
  released?: string;
  /** Printed in a set from the last three years (worked out daily by the data script). */
  standard?: true;
  img: number;
}

const zones = () => [
  { id: 'character', name: 'Character', max: 1, command: true },
  { id: 'main', name: 'Deck', max: 150 },
  { id: 'side', name: 'Sideboard', max: 20 },
];

export const formats: FormatDef[] = [
  {
    id: 'standard',
    name: 'Standard',
    summary: '1 starting character + 60 or more cards sharing its chosen symbol, up to 4 of each, optional 10-card sideboard. Sets from the last 3 years',
    zones: zones(),
    size: { zones: ['main'], target: 60 },
  },
  {
    id: 'retro',
    name: 'Retro',
    summary: 'Standard deck rules with every card ever printed, Universal Fighting System sets included',
    zones: zones(),
    size: { zones: ['main'], target: 60 },
  },
];

// ---------------------------------------------------------------------------------------------
// Ban lists, from uvsgames.com/news/formats-and-ban-lists/ (updated Sep 7, 2026). UVS Games posts
// changes on the first Tuesday of each month. Names, since reprints count as the same card.

const BANNED: Record<string, string[]> = {
  standard: [
    'Immortal Shapeshifter',
    'Mop Strike',
    'Risky Encounter',
    'Vertical Maneuvering Equipment',
    'Teaming With The Attack Titan',
    'Sweeping Daggers',
    'The Nine Titans From Throughout The Ages',
    'Unyielding Destruction',
    'Equipment Heist',
    'Battra Arrives',
  ],
  retro: [
    'A World Lost to Time', 'Amphibious', 'Ballistic Snap Kick', 'Big Cyclone', 'Big Shot: Judy', 'Big Shot: Punch',
    'Clandestine Research', "Colossus's Thermal Blast", 'Combat Ash', 'Coordinated Effort', 'Deadly Embrace', 'Devil Jin',
    'Downward Spiral', 'Drew Maffei, Lion Buddy', 'Equipment Heist', 'Evil Bow', 'Fatality', 'Frog Lashing', 'Genesis',
    'Graven Castle Ruins', 'Harnessing Chaos', 'Jiffany Jamber', "Kaden's Blindfold", 'Kali Yuga', 'Kunai Ikkinage',
    'Lion Stance', 'Meddling With Higher Powers', 'Mourning the Lost', 'New Seong Style: Scarlet Meteor', 'No Equal',
    'Omega Sword and Owl Shield', 'Paid to Protect', 'Penance', 'Princess Parry', 'Protecting the Protector',
    'Punishment Time!', 'Pure of Heart', 'Resurrected Evil', 'Righteousness', 'Risky Encounter', 'Shadow Slicer',
    'Shield Big Bang', 'Shokan Prince', 'Shoki Gehosen', 'Slay Ride Stowaway', 'Summer Heat', 'Superior Technique',
    'Suspicious of Mr. X', 'Syi Salika & Loka Luha', 'The Golden Ticket', 'Twisting Azure Inferno', 'UFS House',
    'Unwavering Slash', 'When the Moon Comes Over the Mountain…',
  ],
};
/**
 * Retro also bans particular versions of these characters (the list marks them with dots, e.g.
 * "·· Jedah ··"). We can't tell versions apart from the data, so these get a warning to check.
 */
const RETRO_CHARACTER_VERSIONS = [
  'Andy', 'Cassandra', 'Chin', 'Garett Brett', 'Gemini Man', 'Geoffrey', 'Gill', 'Goro', 'Huitzil', 'Jedah', 'Joe Hill',
  'Liu Kang', 'Lord Raptor', 'Mature', 'Maxima', 'Momo Yaoyorozu', 'Napalm Man', 'Paul Bittner', 'Quan Chi', 'Ryu',
  'Sasha', 'Sheeva', 'Shinnok', 'Terry', 'Truong', 'Twinkle Murdock', 'Yoshimitsu', 'Zoey',
];

const loose = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const bannedIn = Object.fromEntries(Object.entries(BANNED).map(([f, names]) => [f, new Set(names.map(loose))]));
const retroVersions = new Set(RETRO_CHARACTER_VERSIONS.map(loose));
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function illegal(card: UvsCard, format: FormatDef, today = new Date().toISOString().slice(0, 10)): string | null {
  if (bannedIn[format.id]?.has(loose(card.name))) return `banned in ${format.name}`;
  if (card.released && card.released > today) return `not released until ${fmtDay(card.released)}`;
  if (format.id === 'standard' && !card.standard) return 'rotated out of Standard';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Symbols

export const SYMBOLS = ['Air', 'All', 'Chaos', 'Death', 'Earth', 'Evil', 'Fire', 'Good', 'Life', 'Order', 'Void', 'Water'];
const isInfinity = (c: UvsCard) => c.symbols.includes('Infinity');

export const characterOf = (deck: Deck, cards: CardIndex<UvsCard>) => cards.get(deck.zones.character?.[0]?.id ?? '');

/** The symbols the character offers for deck building (an Infinity character: any one, chosen). */
export const characterSymbols = (ch: UvsCard) => (isInfinity(ch) ? SYMBOLS : ch.symbols.filter((s) => s !== 'Infinity'));

/** Why a card fits the deck ("primary", "attuned Fire", "infinity", "character rule"), or null if it doesn't. */
export function fitReason(card: UvsCard, primary: string, ch: UvsCard): string | null {
  if (isInfinity(card)) return 'infinity';
  if (card.symbols.includes(primary)) return 'primary';
  // An Infinity character has no other symbols during deck building, only its primary.
  const has = isInfinity(ch) ? [primary] : ch.symbols;
  const via = (card.attuned ?? []).find((s) => has.includes(s));
  if (via) return `attuned ${via}`;
  const rule = characterRule(ch);
  if (rule.anySymbol && rule.anySymbol(card)) return 'character rule';
  return null;
}

/** Deck entries in the main deck and sideboard, with their cards. */
const deckCards = (deck: Deck, cards: CardIndex<UvsCard>) =>
  [...(deck.zones.main ?? []), ...(deck.zones.side ?? [])].map((e) => ({ e, c: cards.get(e.id) })).filter((x): x is { e: Entry; c: UvsCard } => !!x.c);

/** How many cards (copies) fit with each primary symbol the character offers. */
export function symbolFits(deck: Deck, cards: CardIndex<UvsCard>): { symbol: string; fit: number }[] {
  const ch = characterOf(deck, cards);
  if (!ch) return [];
  const list = deckCards(deck, cards);
  return characterSymbols(ch).map((symbol) => ({ symbol, fit: list.filter((x) => fitReason(x.c, symbol, ch)).reduce((n, x) => n + x.e.qty, 0) }));
}

/** The deck's primary symbol: the one chosen, else whichever fits the most cards. */
export function primaryOf(deck: Deck, cards: CardIndex<UvsCard>): string | null {
  const ch = characterOf(deck, cards);
  if (!ch) return null;
  const options = characterSymbols(ch);
  const chosen = deck.options?.primary;
  if (chosen && options.includes(chosen)) return chosen;
  const fits = symbolFits(deck, cards);
  return [...fits].sort((a, b) => b.fit - a.fit)[0]?.symbol ?? options[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Characters that change deck building, read from their text:
//  "Your deck may include Vestige foundations regardless of symbol restrictions." (Deku)
//  "Your deck may include up to 8 copies of 1 Ally attack card." (MAY)

interface CharacterRule {
  anySymbol?: (c: UvsCard) => boolean;
  extraCopies?: { n: number; test: (c: UvsCard) => boolean };
}
const hasKeyword = (c: UvsCard, k: string) => (c.keywords ?? []).some((x) => loose(x) === loose(k)) || new RegExp(`\\b${k}\\b`, 'i').test(c.text ?? '');

export function characterRule(ch: UvsCard | undefined): CharacterRule {
  const t = ch?.text ?? '';
  const rule: CharacterRule = {};
  const any = /may include (\w+) (attack|foundation|action|asset|backup)s? regardless of symbol/i.exec(t);
  if (any) rule.anySymbol = (c) => c.type.toLowerCase() === any[2].toLowerCase() && hasKeyword(c, any[1]);
  const more = /may include up to (\d+) copies of 1 (\w+) (attack|foundation|action|asset|backup) card/i.exec(t);
  if (more) rule.extraCopies = { n: Number(more[1]), test: (c) => c.type.toLowerCase() === more[3].toLowerCase() && hasKeyword(c, more[2]) };
  return rule;
}

/** A card's own limit: "You can include up to 8 copies of this card in your deck." */
export function printedLimit(card: UvsCard): number | null {
  const t = card.text ?? '';
  if (/any number of copies of this card/i.test(t)) return 99;
  const m = /include up to (\d+) copies of this card/i.exec(t);
  return m ? Number(m[1]) : null;
}

export function maxCopies(card: UvsCard, _format: FormatDef, deck?: Deck, cards?: CardIndex<UvsCard>): number {
  if (card.type === 'Character' && !deck) return 4;
  const printed = printedLimit(card);
  if (printed != null) return printed;
  const extra = deck && cards ? characterRule(characterOf(deck, cards)).extraCopies : undefined;
  if (extra?.test(card)) {
    // Only one such card gets the bonus: whichever already has more than 4.
    const other = deckCards(deck!, cards!).find((x) => x.c.id !== card.id && extra.test(x.c) && x.e.qty > 4);
    if (!other) return extra.n;
  }
  return 4;
}

// ---------------------------------------------------------------------------------------------
// Validation

function symbolIssues(deck: Deck, cards: CardIndex<UvsCard>): Issue[] {
  const ch = characterOf(deck, cards);
  const primary = primaryOf(deck, cards);
  if (!ch || !primary) return [];
  const issues: Issue[] = [];
  const unknown = deckCards(deck, cards).filter((x) => !x.c.symbols.length);
  const off = deckCards(deck, cards).filter((x) => x.c.symbols.length && !fitReason(x.c, primary, ch));
  if (off.length) {
    const names = off.slice(0, 8).map((x) => x.c.name);
    if (off.length > 8) names.push(`and ${off.length - 8} more`);
    issues.push({ level: 'error', message: `Missing the ${primary} symbol (and no attuned symbol ${ch.name} has): ${names.join(', ')}`, cards: off.map((x) => x.c.id) });
  }
  if (unknown.length)
    issues.push({ level: 'warning', message: `Symbols unknown (check the card): ${unknown.map((x) => x.c.name).join(', ')}`, cards: unknown.map((x) => x.c.id) });
  return issues;
}

function placementIssues(deck: Deck, cards: CardIndex<UvsCard>): Issue[] {
  const issues: Issue[] = [];
  const startBad = (deck.zones.character ?? []).filter((e) => cards.get(e.id) && cards.get(e.id)!.type !== 'Character');
  if (startBad.length) issues.push({ level: 'error', message: `Only a character can be the starting character`, cards: startBad.map((e) => e.id) });
  // Extra characters may go in the deck only with printed difficulty and check.
  const deckChars = deckCards(deck, cards).filter((x) => x.c.type === 'Character' && (x.c.difficulty == null || x.c.check == null));
  if (deckChars.length)
    issues.push({ level: 'error', message: `Characters without difficulty and check can only be the starting character: ${deckChars.map((x) => x.c.name).join(', ')}`, cards: deckChars.map((x) => x.c.id) });
  return issues;
}

function sideboardIssues(deck: Deck): Issue[] {
  const n = (deck.zones.side ?? []).reduce((s, e) => s + e.qty, 0);
  if (!n || n === 10) return [];
  return [{ level: 'warning', message: n > 10 ? `Sideboard: ${n}/10. Cut ${n - 10}` : `Sideboard: ${n}/10. Tournament sideboards are exactly 10 (or none)` }];
}

function copyLimitIssues(deck: Deck, cards: CardIndex<UvsCard>, format: FormatDef): Issue[] {
  const issues: Issue[] = [];
  for (const { e, c } of deckCards(deck, cards)) {
    const total = deckCards(deck, cards).filter((x) => x.c.id === c.id).reduce((n, x) => n + x.e.qty, 0);
    const max = maxCopies(c, format, deck, cards);
    if (total > max && e === deckCards(deck, cards).find((x) => x.c.id === c.id)?.e) issues.push({ level: 'error', message: `${c.name}: ${total} copies, max ${max}`, cards: [c.id] });
  }
  return issues;
}

function retroVersionWarnings(deck: Deck, cards: CardIndex<UvsCard>, format: FormatDef): Issue[] {
  if (format.id !== 'retro') return [];
  const ch = characterOf(deck, cards);
  const hits = [ch, ...deckCards(deck, cards).map((x) => x.c)].filter((c): c is UvsCard => !!c && c.type === 'Character' && retroVersions.has(loose(c.name)));
  return hits.length ? [{ level: 'warning', message: `Retro bans certain versions of: ${[...new Set(hits.map((c) => c.name))].join(', ')}. Check yours against the official list`, cards: hits.map((c) => c.id) }] : [];
}

function validate(deck: Deck, cards: CardIndex<UvsCard>, format: FormatDef): Issue[] {
  return [
    ...exactZone(deck, 'character', 1, 'starting character'),
    ...sizeIssues(deck, format),
    ...sideboardIssues(deck),
    ...symbolIssues(deck, cards),
    ...placementIssues(deck, cards),
    ...legalityIssues(game, deck, cards, format),
    ...retroVersionWarnings(deck, cards, format),
    ...copyLimitIssues(deck, cards, format),
    ...unknownCards(deck, cards),
  ];
}

// ---------------------------------------------------------------------------------------------
// Display

const SYMBOL_STYLE: Record<string, { text: string; color: string }> = {
  Air: { text: '💨', color: '#a5f3fc' },
  All: { text: '✳️', color: '#e5e7eb' },
  Chaos: { text: '🌀', color: '#c084fc' },
  Death: { text: '💀', color: '#94a3b8' },
  Earth: { text: '⛰️', color: '#b45309' },
  Evil: { text: '😈', color: '#dc2626' },
  Fire: { text: '🔥', color: '#f97316' },
  Good: { text: '😇', color: '#fde68a' },
  Life: { text: '🌿', color: '#4ade80' },
  Order: { text: '⚖️', color: '#60a5fa' },
  Void: { text: '🕳️', color: '#7c3aed' },
  Water: { text: '💧', color: '#38bdf8' },
  Infinity: { text: '∞', color: '#f472b6' },
};

export function badges(c: UvsCard): Badge[] {
  return c.symbols.map((s) => {
    const attuned = c.attuned?.includes(s) ?? false;
    const style = SYMBOL_STYLE[s] ?? { text: s.slice(0, 1), color: '#94a3b8' };
    return { text: style.text, color: style.color, square: attuned, title: attuned ? `${s} (attuned)` : s };
  });
}

const PLURAL: Record<string, string> = { Character: 'Characters', Attack: 'Attacks', Foundation: 'Foundations', Action: 'Actions', Asset: 'Assets', Backup: 'Backups', Arena: 'Arenas' };

function exportDeck(deck: Deck, cards: CardIndex<UvsCard>): string {
  const name = listNamer(cards, (c) => c.name);
  const lines = (zone: string) =>
    (deck.zones[zone] ?? []).map((e) => {
      const c = cards.get(e.id);
      return `${e.qty} ${c ? name(c) : e.id}`;
    });
  const parts = [['Character', ...lines('character')], ['Deck', ...lines('main')]];
  if (deck.zones.side?.length) parts.push(['Sideboard', ...lines('side')]);
  return parts.map((p) => p.join('\n')).join('\n\n');
}

function importDeck(text: string, cards: CardIndex<UvsCard>, all: FormatDef[]): Imported {
  return parseTextDeck(game, text, cards, all[0]);
}

export const game: GameDef<UvsCard> = {
  id: 'universus',
  title: "Milk's UniVersus Deck Builder",
  game: 'UniVersus',
  formats,
  zoneFor: (c) => (c.type === 'Character' ? 'character' : 'main'),
  maxCopies,
  illegal: (c, f) => illegal(c, f),
  validate,

  label: (c) => c.name,
  setCode: (c) => c.set.replace(/^UniVersus:s*/, ''),
  group: (c) => PLURAL[c.type] ?? `${c.type}s`,
  groups: ['Characters', 'Attacks', 'Foundations', 'Actions', 'Assets', 'Backups', 'Arenas'],
  cost: (c) => (c.type === 'Character' ? null : c.difficulty),
  image: (c) => ({ src: `https://tcgplayer-cdn.tcgplayer.com/product/${c.img}_400w.jpg` }),
  labelStacks: true,
  badges,
  details: (c) => {
    const rows: [string, string][] = [['Type', c.type], ['IP', c.ip]];
    rows.push(['Symbols', c.symbols.map((s) => (c.attuned?.includes(s) ? `${s} (attuned)` : s)).join(', ') || 'Unknown']);
    if (c.handSize != null) rows.push(['Hand size', String(c.handSize)]);
    if (c.health != null) rows.push(['Health', String(c.health)]);
    if (c.difficulty != null || c.check != null) rows.push(['Difficulty / check', `${c.difficulty ?? '–'} / ${c.check ?? '–'}`]);
    if (c.speed != null || c.damage) rows.push(['Attack', `${c.attackZone ?? ''} · speed ${c.speed ?? '–'} · damage ${c.damage ?? '–'}`.replace(/^ · /, '')]);
    if (c.blockMod) rows.push(['Block', `${c.blockZone ?? ''} ${c.blockMod}`.trim()]);
    if (c.keywords?.length) rows.push(['Keywords', c.keywords.join(', ')]);
    rows.push(['Set', `${c.set} · ${c.rarity}`]);
    if (!c.standard) rows.push(['Standard', 'Rotated out. Retro only']);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => (c.text ? [c.text] : []),
  searchText: (c) => [c.name, c.type, c.ip, ...c.symbols, ...(c.keywords ?? []), c.text, c.set].filter(Boolean).join(' ').toLowerCase(),
  filters: [
    { id: 'ip', label: 'IP', values: (c) => [c.ip] },
    { id: 'type', label: 'Type', values: (c) => [c.type], options: ['Character', 'Attack', 'Foundation', 'Action', 'Asset', 'Backup', 'Arena'] },
    { id: 'symbol', label: 'Symbol', values: (c) => c.symbols, options: [...SYMBOLS, 'Infinity'] },
    { id: 'attuned', label: 'Attuned', values: (c) => c.attuned ?? [], options: SYMBOLS },
    { id: 'difficulty', label: 'Difficulty', values: (c) => (c.difficulty == null ? [] : [c.difficulty >= 8 ? '8+' : String(c.difficulty)]), options: ['0', '1', '2', '3', '4', '5', '6', '7', '8+'] },
    { id: 'check', label: 'Check', values: (c) => (c.check == null ? [] : [String(c.check)]), options: ['0', '1', '2', '3', '4', '5', '6'] },
  ],
  stats: ['type', 'symbol', 'difficulty'],

  deckOptions: [
    {
      id: 'primary',
      label: 'Primary symbol',
      choices: (deck, cards) =>
        symbolFits(deck, cards).map(({ symbol, fit }) => ({ value: symbol, label: `${SYMBOL_STYLE[symbol]?.text ?? ''} ${symbol}`.trim(), hint: `${fit} fit` })),
      auto: (deck, cards) => primaryOf({ ...deck, options: {} }, cards),
    },
  ],

  fit: {
    label: "Fits my deck's symbols",
    miss: (c, deck, cards) => {
      const ch = characterOf(deck, cards);
      const primary = primaryOf(deck, cards);
      return ch && primary && c.symbols.length && !fitReason(c, primary, ch) ? `Needs ${primary}` : null;
    },
    test: (c, deck, cards) => {
      const ch = characterOf(deck, cards);
      const primary = primaryOf(deck, cards);
      return !ch || !primary || c.type === 'Character' || !!fitReason(c, primary, ch);
    },
  },
  toggles: [
    {
      id: 'ip',
      label: 'Same IP as my character',
      test: (c, deck, cards) => {
        const ch = characterOf(deck, cards);
        return !ch || c.ip === ch.ip;
      },
    },
  ],

  goldfish: {
    hand: 7,
    handFrom: (deck, cards) => characterOf(deck, cards)?.handSize ?? 7,
    refill: true,
    mulligans: 1,
    draw: 0,
    turn: 'Turn',
    zones: ['main'],
    counter: { name: 'Health', first: 20, perTurn: 0, max: 0, firstFrom: (deck, cards) => characterOf(deck, cards)?.health ?? 20 },
    note: "Your opening hand is your character's hand size, and each turn you draw back up to it. Use the Health − / + to track damage.",
    odds: [
      { label: 'Foundation', test: (c) => c.type === 'Foundation' },
      { label: 'Attack (difficulty 3 or less)', test: (c) => c.type === 'Attack' && c.difficulty != null && c.difficulty <= 3 },
      { label: 'Action', test: (c) => c.type === 'Action' },
      { label: 'Asset', test: (c) => c.type === 'Asset' },
    ],
  },

  importHint: 'Paste a list like "4 Card Name" per line, with "Character", "Deck" and "Sideboard" headings.',
  exportLabel: 'Copy decklist (text)',
  exportDeck,
  importDeck,
  tcgProductLine: 'UniVersus',
  massEntryById: true,
};
