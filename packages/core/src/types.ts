// Shapes shared by every game. A game app describes itself with a GameDef; the core UI does the rest.

/** The fields every game's cards have. Games extend this with their own fields. */
export interface Card {
  /** Stable id, e.g. "SOR_059". Saved in decks, so it must not change between data updates. */
  id: string;
  name: string;
  /** USD market price of the cheapest standard printing; null when TCGplayer has none. */
  price: number | null;
  /** TCGplayer product id of that printing. */
  tcg?: number;
  /** Ids of the card's other printings, so imported decklists naming a reprint still resolve. */
  alt?: string[];
}

export interface CardData<C extends Card> {
  /** When the data (and prices) were downloaded, ISO time. */
  updated: string;
  cards: C[];
}

/** Lookup by id, including other printings' ids. */
export type CardIndex<C extends Card> = Map<string, C>;

export interface Entry {
  id: string;
  qty: number;
  /** How many of qty you already have. Saved per deck; there's no shared collection. */
  owned: number;
}

export interface Deck {
  id: string;
  name: string;
  format: string;
  created: number;
  updated: number;
  /** Cards per zone, e.g. { leader: [...], base: [...], main: [...], side: [...] }. */
  zones: Record<string, Entry[]>;
  notes?: string;
}

/** error: the deck isn't legal yet. warning: legal or nearly, but worth a look (too many cards, cost penalties). */
export type Level = 'error' | 'warning';
export interface Issue {
  level: Level;
  message: string;
  /** Ids of the cards involved, highlighted in the deck list. */
  cards?: string[];
}

export interface ZoneDef {
  id: string;
  name: string;
  /**
   * Hard cap on cards in this zone. Set well above the legal size so you can add everything
   * you're considering and cut down afterwards; validation warns when you're over the real limit.
   */
  max: number;
  /** Shown compactly at the top of the deck (leaders, bases) rather than as a list. */
  command?: boolean;
}

export interface FormatDef {
  id: string;
  name: string;
  /** One line shown when choosing a format, e.g. "1 leader, 1 base, 50+ cards, up to 3 copies". */
  summary: string;
  zones: ZoneDef[];
  /** The deck-size counter: which zones count toward it and the number to hit. */
  size: { zones: string[]; target: number; exact?: boolean };
}

export interface FilterDef<C extends Card> {
  id: string;
  label: string;
  /** The card's values for this filter; a card matches if any of them is selected. */
  values(card: C): (string | number)[];
  /** Display order; defaults to sorted values found in the data. */
  options?: (string | number)[];
}

export interface Imported {
  name?: string;
  /** Format id, when the decklist says. */
  format?: string;
  zones: Record<string, Entry[]>;
  /** Lines or ids that didn't match any card. */
  skipped: string[];
}

export interface GameDef<C extends Card> {
  /** Short id, used for storage names. */
  id: string;
  /** Full app name, e.g. "Milk's SWU Deck Builder". */
  title: string;
  /** Game name, e.g. "Star Wars: Unlimited". */
  game: string;
  formats: FormatDef[];
  /** Where a card goes when added in this format, or null if it can't be added at all. */
  zoneFor(card: C, format: FormatDef): string | null;
  /** Most copies of this card allowed, counted across all zones. Caps the + button. */
  maxCopies(card: C, format: FormatDef): number;
  validate(deck: Deck, cards: CardIndex<C>, format: FormatDef): Issue[];

  /** Display name, e.g. "Darth Vader, Dark Lord of the Sith". */
  label(card: C): string;
  /** Deck list section for the card ("Units", "Events"), in groups order. */
  group(card: C): string;
  groups: string[];
  /** Cost for sorting and the cost curve; null for cards without one. */
  cost(card: C): number | null;
  image(card: C): { src: string; back?: string; landscape?: boolean };
  /** Label/value rows for the card detail view. */
  details(card: C): [string, string][];
  /** Rules text paragraphs for the card detail view. */
  text(card: C): string[];
  /** Everything free-text search should match. */
  searchText(card: C): string;
  filters: FilterDef<C>[];
  /** An optional search toggle such as "Fits my leaders": cards that suit what's already in the deck. */
  fit?: { label: string; test(card: C, deck: Deck, cards: CardIndex<C>, format: FormatDef): boolean };

  /** What import accepts, shown in the import dialog. */
  importHint: string;
  /** Button label for exportDeck, e.g. "Copy JSON (SWUDB / Karabast)". */
  exportLabel: string;
  /** Exports a decklist other tools can import. */
  exportDeck(deck: Deck, cards: CardIndex<C>): string;
  /** Parses an exported decklist. Throws with a readable message if it can't. */
  importDeck(text: string, cards: CardIndex<C>, formats: FormatDef[]): Imported;
  /** One line for TCGplayer's Mass Entry box. */
  massEntryLine(card: C, qty: number): string;
}
