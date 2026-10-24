// Pokémon TCG for the shared deck builder: Standard and Expanded.
//
// Deck rules: exactly 60 cards; up to 4 cards with the same NAME (all "Pikachu" together), Basic Energy
// excepted; at least one Basic Pokémon; one ACE SPEC and one Radiant Pokémon per deck; one of each Prism
// Star card. Standard is the current rotation (legality comes with the card data from TCGdex);
// Expanded is Black & White onward with the banned list below.

import { legalityIssues, sizeIssues, unknownCards } from '@milk/core/rules';
import type { Badge, Card, CardIndex, Deck, Entry, FormatDef, GameDef, Imported, Issue } from '@milk/core/types';
import { money } from '@milk/core/util';

export interface PkCard extends Card {
  category: 'Pokemon' | 'Trainer' | 'Energy' | string;
  stage?: string;
  hp?: number;
  types?: string[];
  evolveFrom?: string;
  trainerType?: string;
  energyType?: string;
  basicEnergy?: true;
  /** Regulation mark of the newest standard printing. */
  mark?: string;
  rarity?: string;
  /** Rule-box kinds: ex, V, VSTAR, VMAX, GX, EX. */
  tags?: string[];
  aceSpec?: true;
  radiant?: true;
  prismStar?: true;
  abilities?: string[];
  attacks?: string[];
  text?: string;
  weakness?: string;
  retreat?: number;
  set: string;
  released?: string;
  /** Pokémon TCG Live codes of every printing ("PAF 54"), and the one to export. */
  codes: string[];
  code?: string;
  standard?: true;
  img?: string;
}

const zones = () => [{ id: 'main', name: 'Deck', max: 120 }];
export const formats: FormatDef[] = [
  { id: 'standard', name: 'Standard', summary: 'Exactly 60 cards, 4 per name, cards from the current rotation', zones: zones(), size: { zones: ['main'], target: 60, exact: true } },
  { id: 'expanded', name: 'Expanded', summary: 'Standard deck rules with every card from Black & White on, minus the banned list', zones: zones(), size: { zones: ['main'], target: 60, exact: true } },
];

// ---------------------------------------------------------------------------------------------
// Expanded banned list, from pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list.
// Each entry names the card and the printings banned (Pokémon TCG Live set code + number), since
// several bans hit one card of a common name (only two of the many Unown). No Standard bans today.

const EXPANDED_BANS: { name: string; printings: string[] }[] = [
  { name: 'Archeops', printings: ['NVI 67', 'DEX 110'] },
  { name: 'Chip-Chip Ice Axe', printings: ['UNB 165'] },
  { name: 'Delinquent', printings: ['BKP 98'] },
  { name: 'Duskull', printings: ['CEC 83'] },
  { name: 'Flabébé', printings: ['FLI 83'] },
  { name: 'Flapple', printings: ['RCL 22', 'SHF SV013', 'ASR TG02', 'PR-SW SWSH022'] },
  { name: 'Forest of Giant Plants', printings: ['AOR 74'] },
  { name: 'Ghetsis', printings: ['PLF 101', 'PLF 115'] },
  { name: 'Hex Maniac', printings: ['AOR 75'] },
  { name: 'Island Challenge Amulet', printings: ['CEC 194', 'CEC 265'] },
  { name: 'Jessie & James', printings: ['HIF 58', 'HIF 68'] },
  { name: 'Lt. Surge’s Strategy', printings: ['UNB 178', 'HIF 60'] },
  { name: 'Lysandre’s Trump Card', printings: ['PHF 99', 'PHF 118'] },
  { name: 'Marshadow', printings: ['SLG 45', 'PR-SM SM85'] },
  { name: 'Maxie’s Hidden Ball Trick', printings: ['PRC 133', 'PRC 158'] },
  { name: 'Medicham V', printings: ['EVS 83', 'EVS 185', 'EVS 186'] },
  { name: 'Milotic', printings: ['FLF 23'] },
  { name: 'Mismagius', printings: ['UNB 78'] },
  { name: 'Oranguru', printings: ['UPR 114'] },
  { name: 'Puzzle of Time', printings: ['BKP 109'] },
  { name: 'Red Card', printings: ['XY 124', 'GEN 71'] },
  { name: 'Reset Stamp', printings: ['UNM 206', 'UNM 253'] },
  { name: 'Sableye', printings: ['DEX 62'] },
  { name: 'Scoop Up Net', printings: ['RCL 165', 'RCL 207'] },
  { name: 'Shaymin-EX', printings: ['ROS 77', 'ROS 106'] },
  { name: 'Unown', printings: ['LOT 90', 'LOT 91'] },
];

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]/g, '');
/** "PAF 054" and "paf 54" compare equal. */
const normCode = (code: string) => {
  const [set, num = ''] = code.trim().split(/\s+/);
  return `${set.toUpperCase()} ${num.replace(/^([A-Z]*)0+(?=\d)/i, '$1').toUpperCase()}`;
};

export function bannedInExpanded(card: PkCard): boolean {
  const codes = new Set(card.codes.map(normCode));
  return EXPANDED_BANS.some((b) => norm(b.name) === norm(card.name) && b.printings.some((p) => codes.has(normCode(p))));
}

export function illegal(card: PkCard, format: FormatDef): string | null {
  if (format.id === 'standard' && !card.standard) return `not Standard-legal${card.mark ? ` (regulation mark ${card.mark})` : ''}`;
  if (format.id === 'expanded' && bannedInExpanded(card)) return 'banned in Expanded';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Copy limits and deck rules

const isBasicPokemon = (c: PkCard) => c.category === 'Pokemon' && c.stage === 'Basic';
const deckRows = (deck: Deck, cards: CardIndex<PkCard>) =>
  (deck.zones.main ?? []).map((e) => ({ e, c: cards.get(e.id) })).filter((x): x is { e: Entry; c: PkCard } => !!x.c);

/** How many of this card the deck may hold, given the other cards it already has with the same name. */
export function maxCopies(card: PkCard, _format?: FormatDef, deck?: Deck, cards?: CardIndex<PkCard>): number {
  if (card.basicEnergy) return 60;
  if (card.aceSpec || card.radiant || card.prismStar) return 1;
  if (!deck || !cards) return 4;
  const others = deckRows(deck, cards)
    .filter((x) => x.c.id !== card.id && x.c.name === card.name)
    .reduce((n, x) => n + x.e.qty, 0);
  return Math.max(0, 4 - others);
}

function ruleIssues(deck: Deck, cards: CardIndex<PkCard>): Issue[] {
  const rows = deckRows(deck, cards);
  const issues: Issue[] = [];
  if (rows.length && !rows.some((x) => isBasicPokemon(x.c))) issues.push({ level: 'error', message: 'Add at least one Basic Pokémon' });

  // 4 per name, counting every card with that name.
  const byName = new Map<string, { n: number; ids: string[] }>();
  for (const { e, c } of rows) {
    if (c.basicEnergy) continue;
    const x = byName.get(c.name) ?? byName.set(c.name, { n: 0, ids: [] }).get(c.name)!;
    x.n += e.qty;
    x.ids.push(c.id);
  }
  for (const [name, x] of byName) if (x.n > 4) issues.push({ level: 'error', message: `${name}: ${x.n} copies${x.ids.length > 1 ? ` across ${x.ids.length} cards` : ''}, max 4 per name`, cards: x.ids });

  const count = (f: (c: PkCard) => boolean) => rows.filter((x) => f(x.c));
  const aces = count((c) => !!c.aceSpec);
  if (aces.reduce((n, x) => n + x.e.qty, 0) > 1)
    issues.push({ level: 'error', message: `Only 1 ACE SPEC card per deck: ${aces.map((x) => x.c.name).join(', ')}`, cards: aces.map((x) => x.c.id) });
  const radiant = count((c) => !!c.radiant);
  if (radiant.reduce((n, x) => n + x.e.qty, 0) > 1)
    issues.push({ level: 'error', message: `Only 1 Radiant Pokémon per deck: ${radiant.map((x) => x.c.name).join(', ')}`, cards: radiant.map((x) => x.c.id) });
  for (const x of count((c) => !!c.prismStar)) if (x.e.qty > 1) issues.push({ level: 'error', message: `${x.c.name}: only 1 copy of a Prism Star card`, cards: [x.c.id] });
  return issues;
}

/** Evolved Pokémon whose earlier stage isn't in the deck (Rare Candy covers a missing Stage 1). */
function evolutionIssues(deck: Deck, cards: CardIndex<PkCard>): Issue[] {
  const rows = deckRows(deck, cards);
  const names = new Set(rows.map((x) => x.c.name));
  const hasCandy = names.has('Rare Candy');
  const all = [...new Set(cards.values())];
  const basicOf = (stage1: string) => all.find((c) => c.name === stage1)?.evolveFrom;
  const missing: string[] = [];
  const ids: string[] = [];
  for (const { c } of rows) {
    if (c.category !== 'Pokemon' || !c.evolveFrom || names.has(c.evolveFrom)) continue;
    if (c.stage === 'Stage2' && hasCandy) {
      const basic = basicOf(c.evolveFrom);
      if (!basic || names.has(basic)) continue;
      missing.push(`${c.name} needs ${basic}`);
    } else missing.push(`${c.name} needs ${c.evolveFrom}`);
    ids.push(c.id);
  }
  return missing.length ? [{ level: 'warning', message: `Evolution lines: ${[...new Set(missing)].join('; ')}`, cards: ids }] : [];
}

function validate(deck: Deck, cards: CardIndex<PkCard>, format: FormatDef): Issue[] {
  return [...sizeIssues(deck, format), ...ruleIssues(deck, cards), ...legalityIssues(game, deck, cards, format), ...evolutionIssues(deck, cards), ...unknownCards(deck, cards)];
}

// ---------------------------------------------------------------------------------------------
// Decklists: the Pokémon TCG Live format.
//   Pokémon: 12
//   4 Charmander OBF 26
//   Trainer: 36
//   …
//   Energy: 12
//   8 Basic {R} Energy SVE 2

const ENERGY_SYMBOLS: Record<string, string> = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy' };
/** Pokémon TCG Live names Basic Energy by symbol, from the Scarlet & Violet Energy set (no Fairy there). */
const SVE_NUMBER: Record<string, number> = { G: 1, R: 2, W: 3, L: 4, P: 5, F: 6, D: 7, M: 8 };
function liveName(c: PkCard): string {
  if (c.basicEnergy) {
    const sym = Object.keys(ENERGY_SYMBOLS).find((k) => `${ENERGY_SYMBOLS[k]} Energy` === c.name);
    if (sym && SVE_NUMBER[sym]) return `Basic {${sym}} Energy SVE ${SVE_NUMBER[sym]}`;
  }
  return c.code ? `${c.name} ${normCode(c.code)}` : c.name;
}

function exportDeck(deck: Deck, cards: CardIndex<PkCard>): string {
  const rows = deckRows(deck, cards);
  const section = (title: string, cat: string) => {
    const list = rows.filter((x) => x.c.category === cat);
    if (!list.length) return [];
    return [`${title}: ${list.reduce((n, x) => n + x.e.qty, 0)}`, ...list.map((x) => `${x.e.qty} ${liveName(x.c)}`), ''];
  };
  return [...section('Pokémon', 'Pokemon'), ...section('Trainer', 'Trainer'), ...section('Energy', 'Energy')].join('\n').trim();
}

function importDeck(text: string, cards: CardIndex<PkCard>): Imported {
  const all = [...new Set(cards.values())];
  const byCode = new Map<string, PkCard>();
  for (const c of all) for (const code of c.codes) byCode.set(normCode(code), c);
  const main: Entry[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(pok[eé]mon|trainer|energy|total cards)\s*[:(]/i.test(line) || line.startsWith('//') || line.startsWith('#')) continue;
    const m = /^(\d+)\s+(.+?)(?:\s+([A-Z][A-Z0-9-]{1,7})\s+([A-Z]*\d+[a-z]?))?$/.exec(line);
    if (!m) {
      skipped.push(line);
      continue;
    }
    const qty = Number(m[1]);
    // "Basic {R} Energy" -> "Fire Energy".
    const name = m[2].replace(/^Basic \{(\w)\} Energy$/i, (_, s) => `${ENERGY_SYMBOLS[s.toUpperCase()] ?? s} Energy`);
    let card = m[3] ? byCode.get(normCode(`${m[3]} ${m[4]}`)) : undefined;
    if (!card || norm(card.name) !== norm(name)) {
      // Same name: prefer a Standard-legal card, then the newest.
      const same = all.filter((c) => norm(c.name) === norm(name));
      card = same.sort((a, b) => Number(!!b.standard) - Number(!!a.standard) || (b.released ?? '').localeCompare(a.released ?? ''))[0] ?? card;
    }
    if (!card) {
      skipped.push(line);
      continue;
    }
    const e = main.find((x) => x.id === card!.id);
    if (e) e.qty += qty;
    else main.push({ id: card.id, qty, owned: 0 });
  }
  if (!main.length) throw new Error('No cards recognised in that list');
  const format = main.every((e) => cards.get(e.id)?.standard) ? 'standard' : 'expanded';
  return { format, zones: { main }, skipped };
}

// ---------------------------------------------------------------------------------------------

const TYPE_STYLE: Record<string, { text: string; color: string }> = {
  Grass: { text: '🌿', color: '#22c55e' },
  Fire: { text: '🔥', color: '#f97316' },
  Water: { text: '💧', color: '#38bdf8' },
  Lightning: { text: '⚡', color: '#facc15' },
  Psychic: { text: '🔮', color: '#c084fc' },
  Fighting: { text: '✊', color: '#b45309' },
  Darkness: { text: '🌑', color: '#475569' },
  Metal: { text: '⚙️', color: '#94a3b8' },
  Dragon: { text: '🐉', color: '#ca8a04' },
  Fairy: { text: '🧚', color: '#f472b6' },
  Colorless: { text: '⚪', color: '#e5e7eb' },
};
const STAGE_GROUP: Record<string, string> = { Basic: 'Basic Pokémon', Stage1: 'Stage 1', Stage2: 'Stage 2' };
const group = (c: PkCard) =>
  c.category === 'Pokemon' ? (STAGE_GROUP[c.stage ?? ''] ?? 'Other Pokémon') : c.category === 'Trainer' ? `${c.trainerType ?? 'Trainer'}s` : 'Energy';
const TYPES = Object.keys(TYPE_STYLE);

export const game: GameDef<PkCard> = {
  id: 'pokemon',
  title: "Milk's Pokémon Deck Builder",
  game: 'Pokémon TCG',
  formats,
  zoneFor: () => 'main',
  maxCopies,
  illegal: (c, f) => illegal(c, f),
  validate,

  label: (c) => (c.code ? `${c.name} · ${normCode(c.code)}` : c.name),
  group,
  groups: ['Basic Pokémon', 'Stage 1', 'Stage 2', 'Other Pokémon', 'Supporters', 'Items', 'Tools', 'Stadiums', 'Energy'],
  cost: () => null,
  noCostCurve: true,
  image: (c) => ({ src: c.img ?? '' }),
  badges: (c): Badge[] => [
    ...(c.types ?? []).map((t) => ({ text: TYPE_STYLE[t]?.text ?? t[0], title: t, color: TYPE_STYLE[t]?.color })),
    ...(c.tags ?? []).map((t) => ({ text: t, title: `Rule box: ${t}`, color: '#e5e7eb', square: true })),
    ...(c.aceSpec ? [{ text: 'ACE', title: 'ACE SPEC (1 per deck)', color: '#f43f5e', square: true }] : []),
  ],
  details: (c) => {
    const rows: [string, string][] = [];
    if (c.category === 'Pokemon') {
      rows.push(['Pokémon', `${(STAGE_GROUP[c.stage ?? ''] ?? c.stage ?? '').replace(' Pokémon', '')}${c.evolveFrom ? ` · evolves from ${c.evolveFrom}` : ''}`]);
      if (c.hp) rows.push(['HP', String(c.hp)]);
      if (c.types) rows.push(['Type', c.types.join(', ')]);
      if (c.abilities) rows.push(['Ability', c.abilities.join(', ')]);
      if (c.attacks) rows.push(['Attacks', c.attacks.join(' · ')]);
      if (c.weakness) rows.push(['Weakness', c.weakness]);
      if (c.retreat != null) rows.push(['Retreat', String(c.retreat)]);
    } else rows.push(['Type', c.category === 'Trainer' ? `Trainer · ${c.trainerType ?? ''}` : c.basicEnergy ? 'Basic Energy' : 'Special Energy']);
    if (c.aceSpec) rows.push(['ACE SPEC', 'Only 1 ACE SPEC per deck']);
    if (c.radiant) rows.push(['Radiant', 'Only 1 Radiant Pokémon per deck']);
    rows.push(['Set', `${c.set}${c.code ? ` · ${c.code}` : ''}${c.mark ? ` · mark ${c.mark}` : ''}`]);
    rows.push(['Standard', c.standard ? 'Legal' : 'Not legal (Expanded only)']);
    if (bannedInExpanded(c)) rows.push(['Expanded', 'Banned']);
    rows.push(['Price', money(c.price)]);
    return rows;
  },
  text: (c) => (c.text ? [c.text] : []),
  searchText: (c) =>
    [c.name, c.category, c.stage, c.trainerType, ...(c.types ?? []), c.evolveFrom, ...(c.tags ?? []), ...(c.abilities ?? []), ...(c.attacks ?? []), c.text, c.set, ...c.codes]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  filters: [
    { id: 'category', label: 'Card', values: (c) => [c.category === 'Pokemon' ? 'Pokémon' : c.category], options: ['Pokémon', 'Trainer', 'Energy'] },
    { id: 'type', label: 'Type', values: (c) => c.types ?? [], options: TYPES },
    { id: 'stage', label: 'Stage', values: (c) => (c.category === 'Pokemon' ? [group(c)] : []), options: ['Basic Pokémon', 'Stage 1', 'Stage 2', 'Other Pokémon'] },
    { id: 'trainer', label: 'Trainer', values: (c) => (c.trainerType ? [c.trainerType] : []), options: ['Supporter', 'Item', 'Tool', 'Stadium'] },
    { id: 'rule', label: 'Rule box', values: (c) => [...(c.tags ?? []), ...(c.aceSpec ? ['ACE SPEC'] : []), ...(c.radiant ? ['Radiant'] : [])], options: ['ex', 'V', 'VSTAR', 'VMAX', 'GX', 'EX', 'ACE SPEC', 'Radiant'] },
    { id: 'mark', label: 'Mark', values: (c) => (c.mark ? [c.mark] : []) },
    { id: 'set', label: 'Set', values: (c) => [c.set] },
  ],
  stats: ['category', 'type', 'stage'],

  goldfish: {
    hand: 7,
    mulligans: 0,
    draw: 1,
    turn: 'Turn',
    zones: ['main'],
    openingNeeds: { label: 'Basic Pokémon', test: (c) => isBasicPokemon(c) },
    stack: { name: 'Prizes', count: 6, action: 'Take a prize', to: 'hand' },
    note: 'Draw 7. With no Basic Pokémon the hand is reshuffled and redrawn automatically (your opponent would draw extra). 6 prize cards are set aside when turn 1 starts; going first skips the turn 1 draw.',
    odds: [
      { label: 'Basic Pokémon', test: (c) => isBasicPokemon(c) },
      { label: 'Supporter', test: (c) => c.trainerType === 'Supporter' },
      { label: 'Item', test: (c) => c.trainerType === 'Item' },
      { label: 'Energy', test: (c) => c.category === 'Energy' },
    ],
  },

  importHint: 'Paste a Pokémon TCG Live list ("4 Charmander OBF 26" per line, with Pokémon/Trainer/Energy headings).',
  exportLabel: 'Copy decklist (Pokémon TCG Live)',
  exportDeck,
  importDeck,
  tcgProductLine: 'Pokemon',
  massEntryById: true,
};
