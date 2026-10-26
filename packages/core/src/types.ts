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
  /** That product's exact TCGplayer name, which is what Mass Entry matches on. */
  tcgName?: string;
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
  /** Cards you're thinking about adding (or cutting). Not part of the deck: no size, rules or price. */
  considering?: Entry[];
  /** Game-specific deck settings (UniVersus' primary symbol). Missing means "pick automatically". */
  options?: Record<string, string>;
  /** What the deck does and how to play it. Travels with exported lists. */
  description?: string;
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
  /** How many empty "+ Add" slots to show while it has room (default: all of `max`). */
  placeholders?: number;
}

export interface FormatDef {
  id: string;
  name: string;
  /** One line shown when choosing a format, e.g. "1 leader, 1 base, 50+ cards, up to 3 copies". */
  summary: string;
  zones: ZoneDef[];
  /** The deck-size counter: which zones count toward it and the number to hit. */
  size: { zones: string[]; target: number; exact?: boolean };
  /** Marked "(Recommended)" wherever formats are listed. Put it first so new decks default to it. */
  recommended?: boolean;
}

export interface FilterDef<C extends Card> {
  id: string;
  label: string;
  /** The card's values for this filter; a card matches if any of them is selected. */
  values(card: C): (string | number)[];
  /** Display order; defaults to sorted values found in the data. */
  options?: (string | number)[];
}

export interface GoldfishDef<C extends Card = Card> {
  /** Cards in the opening hand. */
  hand: number;
  /** Opening hand size from the deck instead (UniVersus: the character's hand size). */
  handFrom?(deck: Deck, cards: CardIndex<C>): number;
  /** Each turn, draw back up to the hand size instead of drawing `draw` cards. */
  refill?: boolean;
  /** Free mulligans allowed before the first turn. */
  mulligans: number;
  /** Cards drawn at the start of each later turn (or round). */
  draw: number;
  /** What a turn is called ("Round"). */
  turn: string;
  /**
   * Cards put face down as resources from the opening hand, and how many you may add each turn after
   * (from turn 1 if `firstTurn`, as with Lorcana's inkwell; SWU starts adding in round 2).
   */
  resources?: { setup: number; perTurn: number; firstTurn?: boolean; action?: string; pile?: string };
  /** Which cards may become resources (Lorcana: only inkable ones). */
  canResource?(card: C): boolean;
  /**
   * Face-down cards dealt from the deck once setup is done: Digimon's 5 security cards, or One Piece's
   * life cards, whose number comes from the leader.
   */
  stack?: {
    name: string;
    count: number;
    countFrom?(deck: Deck, cards: CardIndex<C>): number;
    /** Button label for taking the top card ("Take a prize"), and where it goes (default: discard). */
    action?: string;
    to?: 'hand' | 'discard';
  };
  /**
   * The opening hand must hold one of these (Pokémon: a Basic Pokémon). Without one, the hand is
   * reshuffled and redrawn automatically, and the log says how many times.
   */
  openingNeeds?: { label: string; test(card: C): boolean };
  /**
   * A number tracked through the game: One Piece's DON!! (`first` on turn 1, then +`perTurn`, up to `max`),
   * or a health total that only changes by hand (`perTurn` 0, starting value from the deck).
   */
  counter?: { name: string; first: number; perTurn: number; max: number; firstFrom?(deck: Deck, cards: CardIndex<C>): number };
  /** A separate deck from another zone, played from the top (Digimon's Digi-Egg deck). */
  side?: { zone: string; name: string; action: string; into: string };
  /** Zones shuffled into the draw pile. */
  zones: string[];
  /** One line of reminders shown at the top, e.g. how setup works. */
  note?: string;
  /** Dice to roll (Destiny: each character's die, two for elites), each as a list of face labels. */
  dice?(deck: Deck, cards: CardIndex<C>): { name: string; faces: string[] }[];
  /** What the odds table counts; defaults to "cost N or less" for 1–4. */
  odds?: { label: string; test(card: C): boolean }[];
}

/** A per-deck choice shown in the deck's header, e.g. UniVersus' primary symbol. */
export interface DeckOptionDef<C extends Card = Card> {
  id: string;
  label: string;
  /** The choices for this deck right now, with a short hint like "48 cards fit". */
  choices(deck: Deck, cards: CardIndex<C>): { value: string; label: string; hint?: string }[];
  /** What "Auto" picks. */
  auto(deck: Deck, cards: CardIndex<C>): string | null;
}

/** A small tag drawn on a card (UniVersus symbols). `square` marks an attuned symbol. */
export interface Badge {
  text: string;
  title: string;
  color?: string;
  square?: boolean;
}

export interface Imported {
  name?: string;
  /** Format id, when the decklist says. */
  format?: string;
  zones: Record<string, Entry[]>;
  /** Lines or ids that didn't match any card. */
  skipped: string[];
  /** The deck's description, when the list carries one. */
  description?: string;
  /** The Considering list, when the list carries one (our own exports do). */
  considering?: Entry[];
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
  /**
   * Most copies of this card allowed, counted across all zones. Caps the + button. The deck is passed
   * where known, for limits that depend on it (UniVersus: a character allowing 8 copies of one card).
   */
  maxCopies(card: C, format: FormatDef, deck?: Deck, cards?: CardIndex<C>): number;
  /** Why a card isn't allowed in this format at all (rotated out, suspended), or null if it is. */
  illegal?(card: C, format: FormatDef): string | null;
  validate(deck: Deck, cards: CardIndex<C>, format: FormatDef): Issue[];

  /** Display name, e.g. "Darth Vader, Dark Lord of the Sith". */
  label(card: C): string;
  /** Deck list section for the card ("Units", "Events"), in groups order. */
  group(card: C): string;
  groups: string[];
  /** Cost for sorting and the cost curve; null for cards without one. */
  cost(card: C): number | null;
  /** Order of cards within each deck group (default: cost, then name). Flesh and Blood: red, yellow, blue, then name. */
  deckOrder?(a: C, b: C): number;
  image(card: C): { src: string; back?: string; landscape?: boolean };
  /** Cards have no single cost (Pokémon), so the cost curve is left out. */
  noCostCurve?: boolean;
  /** The printed name isn't at the top of the card (UniVersus), so the Deck view labels its stacks. */
  labelStacks?: boolean;
  /** What 2+ copies of a leader-type card mean, e.g. "Elite" for a Destiny character with two dice. */
  qtyLabel?(card: C, qty: number): string | null;
  /** Extra counters in the deck summary, e.g. Destiny's "28/30 points". */
  meters?(deck: Deck, cards: CardIndex<C>, format: FormatDef): { label: string; value: number; max: number }[];
  /** Shown instead of a price when a card has none for a known reason ("Print & play"). */
  priceNote?(card: C): string | null;
  /** Short set code shown beside the price in wide deck lists ("IAR"); the printing priced, where known. */
  setCode?(card: C): string | null;
  /** Label/value rows for the card detail view. */
  details(card: C): [string, string][];
  /** Rules text paragraphs for the card detail view. */
  text(card: C): string[];
  /** Everything free-text search should match. */
  searchText(card: C): string;
  filters: FilterDef<C>[];
  /** Filter ids to break the main deck down by in the Deck view (e.g. aspects, arenas). */
  stats?: string[];
  /** Per-deck settings shown in the deck header. */
  deckOptions?: DeckOptionDef<C>[];
  /** Small tags drawn on cards in search, the deck list and the card view. */
  badges?(card: C): Badge[];
  /** An optional search toggle such as "Fits my leaders": cards that suit what's already in the deck. */
  fit?: {
    label: string;
    /** Tag shown on considered cards that don't fit, e.g. "Aspect penalty +2". Null when it fits. */
    miss(card: C, deck: Deck, cards: CardIndex<C>): string | null;
    test(card: C, deck: Deck, cards: CardIndex<C>, format: FormatDef): boolean;
    /**
     * Turns the toggle on by itself while this is true, e.g. once a Flesh and Blood hero is chosen, since
     * other cards can't go in that deck at all. It can still be switched off, and Clear turns it back on.
     */
    auto?(deck: Deck, cards: CardIndex<C>): boolean;
  };
  /** More search toggles like fit, e.g. UniVersus' "Same IP as my character". */
  toggles?: { id: string; label: string; test(card: C, deck: Deck, cards: CardIndex<C>): boolean }[];
  /** Solo test draws ("goldfishing"). Without it the Goldfish button is hidden. */
  goldfish?: GoldfishDef<C>;

  /** What import accepts, shown in the import dialog. */
  importHint: string;
  /** Button label for exportDeck, e.g. "Copy JSON (SWUDB / Karabast)". */
  exportLabel: string;
  /** Exports a decklist other tools can import. */
  exportDeck(deck: Deck, cards: CardIndex<C>): string;
  /** Parses an exported decklist. Throws with a readable message if it can't. */
  importDeck(text: string, cards: CardIndex<C>, formats: FormatDef[]): Imported;
  /** TCGplayer's product line name for Mass Entry, e.g. "Star Wars Unlimited". */
  tcgProductLine: string;
  /**
   * Send Mass Entry TCGplayer product ids ("4-515604") instead of names. Mass Entry accepts this
   * undocumented form (it's in the page's own line parser) and it can't pick the wrong card, which
   * matters where many cards share a name (Digimon's dozens of "Agumon"). The pasted list shows ids.
   */
  massEntryById?: boolean;
}
