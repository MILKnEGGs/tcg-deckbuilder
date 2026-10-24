// Solo test draws ("goldfishing"): shuffle, opening hand, mulligan, resources, draws per turn.
// No rules are enforced beyond counts; it's for seeing how a deck's hands and curve feel.

import type { Card, CardIndex, Deck, GoldfishDef as Def } from './types';

// The functions here don't care about a game's card type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GoldfishDef = Def<any>;

export interface Fish {
  library: string[];
  hand: string[];
  resources: string[];
  played: string[];
  discard: string[];
  /** Face-down stack dealt at the start (security), top first. */
  stack: string[];
  /** The separate side deck (Digi-Eggs), top first. */
  side: string[];
  /** 0 while setting up (opening hand, mulligan, choosing resources). */
  turn: number;
  mulligansLeft: number;
  /** Resources you may still add this turn. */
  resourcesLeft: number;
  /** The game's per-turn counter (One Piece DON!!). */
  counter: number;
  /** How many stack cards to deal when the first turn starts. */
  stackSize: number;
  /** Opening hand size (and the size to refill to, for games that refill). */
  handSize: number;
  /** The counter's value on turn 1. */
  counterStart: number;
  /** Turn-by-turn record shown in the log, newest last. */
  log: string[];
}

export function shuffle<T>(list: T[], random = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Every copy in the given zones, one id per card. */
export const pile = (deck: Deck, zones: string[]) => zones.flatMap((z) => (deck.zones[z] ?? []).flatMap((e) => Array.from({ length: e.qty }, () => e.id)));

export function start<C extends Card>(deck: Deck, cfg: Def<C>, cards: CardIndex<C> = new Map(), random = Math.random): Fish {
  const library = shuffle(pile(deck, cfg.zones), random);
  const handSize = cfg.handFrom?.(deck, cards) ?? cfg.hand;
  const hand = library.splice(0, handSize);
  const side = cfg.side ? shuffle(pile(deck, [cfg.side.zone]), random) : [];
  return {
    handSize,
    counter: 0,
    counterStart: cfg.counter ? (cfg.counter.firstFrom?.(deck, cards) ?? cfg.counter.first) : 0,
    stackSize: cfg.stack ? (cfg.stack.countFrom?.(deck, cards) ?? cfg.stack.count) : 0,
    library,
    hand,
    resources: [],
    played: [],
    discard: [],
    stack: [],
    side,
    turn: 0,
    mulligansLeft: cfg.mulligans,
    resourcesLeft: cfg.resources?.setup ?? 0,
    log: [`Drew an opening hand of ${hand.length}`],
  };
}

/** Plays the top card of the side deck (e.g. hatches a Digi-Egg). */
export function fromSide(f: Fish, cfg: GoldfishDef): Fish {
  if (!cfg.side || !f.side.length) return f;
  const [top, ...rest] = f.side;
  return { ...f, side: rest, played: [...f.played, top], log: [...f.log, `${cfg.side.action} (${rest.length} left)`] };
}

/** Turns the top card of the face-down stack over into the discard pile (e.g. a security check). */
export function flipStack(f: Fish, cfg: GoldfishDef): Fish {
  if (!cfg.stack || !f.stack.length) return f;
  const [top, ...rest] = f.stack;
  return { ...f, stack: rest, discard: [...f.discard, top], log: [...f.log, `Flipped a ${cfg.stack.name.toLowerCase()} card (${rest.length} left)`] };
}

export function mulligan(f: Fish, random = Math.random): Fish {
  if (f.turn !== 0 || f.mulligansLeft <= 0) return f;
  const library = shuffle([...f.library, ...f.hand], random);
  const hand = library.splice(0, f.handSize);
  return { ...f, library, hand, mulligansLeft: f.mulligansLeft - 1, log: [...f.log, `Mulliganed into a new ${hand.length}`] };
}

/** Moves a hand card somewhere. Resources respect how many you may add right now. */
export function move(f: Fish, i: number, to: 'resources' | 'played' | 'discard'): Fish {
  const card = f.hand[i];
  if (card === undefined) return f;
  if (to === 'resources' && f.resourcesLeft <= 0) return f;
  const hand = f.hand.filter((_, j) => j !== i);
  return {
    ...f,
    hand,
    [to]: [...f[to], card],
    resourcesLeft: to === 'resources' ? f.resourcesLeft - 1 : f.resourcesLeft,
  };
}

/** Puts a played or discarded card back in hand (undo). */
export function unplay(f: Fish, from: 'played' | 'discard' | 'resources', i: number): Fish {
  const card = f[from][i];
  if (card === undefined) return f;
  return { ...f, [from]: f[from].filter((_, j) => j !== i), hand: [...f.hand, card], resourcesLeft: from === 'resources' ? f.resourcesLeft + 1 : f.resourcesLeft };
}

/** Setup is done once the required resources are chosen; then turns begin. */
export const setupDone = (f: Fish, cfg: GoldfishDef) => f.turn > 0 || f.resources.length >= (cfg.resources?.setup ?? 0);

export function nextTurn(f: Fish, cfg: GoldfishDef): Fish {
  if (f.turn === 0) {
    // Setup ends: deal the face-down stack (security) from the top of the deck.
    const library = [...f.library];
    const stack = cfg.stack ? library.splice(0, f.stackSize) : [];
    const counter = cfg.counter ? f.counterStart : 0;
    const parts = [
      cfg.resources ? `${f.resources.length} resources` : '',
      cfg.stack ? `${stack.length} ${cfg.stack.name.toLowerCase()}` : '',
      cfg.counter ? `${counter} ${cfg.counter.name}` : '',
      `${f.hand.length} cards in hand`,
    ];
    return { ...f, library, stack, counter, turn: 1, resourcesLeft: 0, log: [...f.log, `${cfg.turn} 1: ${parts.filter(Boolean).join(', ')}`] };
  }
  const library = [...f.library];
  const want = cfg.refill ? Math.max(0, f.handSize - f.hand.length) : cfg.draw;
  const drawn = library.splice(0, want);
  const turn = f.turn + 1;
  const counter = cfg.counter ? Math.min(Math.max(cfg.counter.max, f.counterStart), f.counter + cfg.counter.perTurn) : 0;
  return {
    ...f,
    library,
    hand: [...f.hand, ...drawn],
    turn,
    counter,
    resourcesLeft: cfg.resources?.perTurn ?? 0,
    log: [...f.log, `${cfg.turn} ${turn}: drew ${drawn.length}${drawn.length < want ? ' (deck empty)' : ''}${cfg.counter ? `, ${counter} ${cfg.counter.name}` : ''}`],
  };
}

/** Adjusts the counter by hand (effects that add or return DON!!). */
export function bumpCounter(f: Fish, cfg: GoldfishDef, by: number): Fish {
  if (!cfg.counter) return f;
  return { ...f, counter: Math.max(0, Math.min(Math.max(cfg.counter.max, f.counterStart), f.counter + by)) };
}

/**
 * Chance of seeing at least one of `hits` specific cards among `seen` cards drawn from a deck of `size`
 * (hypergeometric). E.g. odds of a 2-drop in the opening hand.
 */
export function atLeastOne(size: number, hits: number, seen: number): number {
  if (hits <= 0 || seen <= 0 || size <= 0) return 0;
  if (seen > size - hits) return 1;
  let miss = 1;
  for (let i = 0; i < seen; i++) miss *= (size - hits - i) / (size - i);
  return 1 - miss;
}
