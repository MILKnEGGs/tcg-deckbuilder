// Pure deck helpers. They mutate the deck passed in (the editor owns a reactive copy and saves after).

import type { Card, CardData, CardIndex, Deck, Entry, FormatDef, GameDef } from './types';
import { uid } from './util';

export function newDeck(format: FormatDef, name: string): Deck {
  const now = Date.now();
  return { id: uid(), name, format: format.id, created: now, updated: now, zones: Object.fromEntries(format.zones.map((z) => [z.id, []])) };
}

export function indexCards<C extends Card>(data: CardData<C>): CardIndex<C> {
  const index: CardIndex<C> = new Map();
  for (const c of data.cards) index.set(c.id, c);
  // Other printings resolve to the same card, but never shadow a real id.
  for (const c of data.cards) for (const a of c.alt ?? []) if (!index.has(a)) index.set(a, c);
  return index;
}

export const zoneEntries = (deck: Deck, zone: string): Entry[] => (deck.zones[zone] ??= []);
export const zoneCount = (deck: Deck, zone: string) => (deck.zones[zone] ?? []).reduce((n, e) => n + e.qty, 0);
export const sizeOf = (deck: Deck, format: FormatDef) => format.size.zones.reduce((n, z) => n + zoneCount(deck, z), 0);

/** Copies of a card across all zones (or the given ones). */
export function copies(deck: Deck, id: string, zones = Object.keys(deck.zones)): number {
  let n = 0;
  for (const z of zones) for (const e of deck.zones[z] ?? []) if (e.id === id) n += e.qty;
  return n;
}

export function setQty(deck: Deck, zone: string, id: string, qty: number): void {
  const list = zoneEntries(deck, zone);
  const i = list.findIndex((e) => e.id === id);
  if (qty <= 0) {
    if (i >= 0) list.splice(i, 1);
  } else if (i >= 0) {
    list[i].qty = qty;
    list[i].owned = Math.min(list[i].owned, qty);
  } else {
    list.push({ id, qty, owned: 0 });
  }
  deck.updated = Date.now();
}

/**
 * Adds one copy where the game says the card goes, unless that would break the copy limit or the
 * zone's hard cap. Returns why it couldn't, or null on success.
 */
export function addCard<C extends Card>(game: GameDef<C>, deck: Deck, format: FormatDef, card: C, zone = game.zoneFor(card, format), cards?: CardIndex<C>): string | null {
  if (!zone) return `${game.label(card)} can't go in a ${format.name} deck`;
  const why = game.illegal?.(card, format);
  if (why) return `${game.label(card)}: ${why}`;
  const z = format.zones.find((x) => x.id === zone);
  if (!z) return `${format.name} has no ${zone}`;
  const max = game.maxCopies(card, format, deck, cards);
  if (copies(deck, card.id) >= max) return max === 1 ? `Only 1 ${game.label(card)} allowed` : `Max ${max} copies of ${game.label(card)}`;
  if (zoneCount(deck, zone) >= z.max) return `${z.name} is full (${z.max})`;
  const e = zoneEntries(deck, zone).find((x) => x.id === card.id);
  setQty(deck, zone, card.id, (e?.qty ?? 0) + 1);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Considering: a side list of maybes. Adding there is never refused; limits apply on the way in.

export const considering = (deck: Deck): Entry[] => (deck.considering ??= []);
// Read-only, so it's safe inside the UI's derived values.
export const consideringCount = (deck: Deck, id: string) => (deck.considering ?? []).find((e) => e.id === id)?.qty ?? 0;

export function setConsidering(deck: Deck, id: string, qty: number): void {
  const list = considering(deck);
  const i = list.findIndex((e) => e.id === id);
  if (qty <= 0) {
    if (i >= 0) list.splice(i, 1);
  } else if (i >= 0) {
    list[i].qty = qty;
    list[i].owned = Math.min(list[i].owned, qty);
  } else list.push({ id, qty, owned: 0 });
  deck.updated = Date.now();
}

/** Moves one considered copy into the deck, if the deck's rules allow it. */
export function considerToDeck<C extends Card>(game: GameDef<C>, deck: Deck, format: FormatDef, card: C, cards?: CardIndex<C>): string | null {
  const e = considering(deck).find((x) => x.id === card.id);
  if (!e) return null;
  const err = addCard(game, deck, format, card, undefined, cards);
  if (err) return err;
  // Owned copies come along with it.
  if (e.owned > 0) {
    const zone = game.zoneFor(card, format)!;
    const d = zoneEntries(deck, zone).find((x) => x.id === card.id)!;
    d.owned = Math.min(d.qty, d.owned + 1);
    e.owned--;
  }
  setConsidering(deck, card.id, e.qty - 1);
  return null;
}

/** Moves one copy out of a zone into considering (a possible cut). */
export function deckToConsider(deck: Deck, zone: string, id: string): void {
  const d = zoneEntries(deck, zone).find((x) => x.id === id);
  if (!d) return;
  const wasOwned = d.owned >= d.qty;
  setQty(deck, zone, id, d.qty - 1);
  const e = considering(deck).find((x) => x.id === id);
  setConsidering(deck, id, (e?.qty ?? 0) + 1);
  if (wasOwned) {
    const c = considering(deck).find((x) => x.id === id)!;
    c.owned = Math.min(c.qty, c.owned + 1);
  }
}

/** Tapping "owned" counts up through the copies you have, then back to none. */
export function cycleOwned(deck: Deck, zone: string, id: string): void {
  const e = (zone === 'considering' ? considering(deck) : zoneEntries(deck, zone)).find((x) => x.id === id);
  if (!e) return;
  e.owned = e.owned >= e.qty ? 0 : e.owned + 1;
  deck.updated = Date.now();
}

export function setAllOwned(deck: Deck, owned: boolean): void {
  for (const list of Object.values(deck.zones)) for (const e of list) e.owned = owned ? e.qty : 0;
  deck.updated = Date.now();
}

/** Switching format keeps your cards; zones the new format lacks are folded into the main deck. */
export function changeFormat(deck: Deck, from: FormatDef, to: FormatDef): void {
  const keep = new Set(to.zones.map((z) => z.id));
  for (const z of from.zones) {
    if (keep.has(z.id)) continue;
    for (const e of deck.zones[z.id] ?? []) {
      const dest = zoneEntries(deck, 'main');
      const d = dest.find((x) => x.id === e.id);
      if (d) {
        d.qty += e.qty;
        d.owned += e.owned;
      } else dest.push({ ...e });
    }
    delete deck.zones[z.id];
  }
  for (const z of to.zones) deck.zones[z.id] ??= [];
  deck.format = to.id;
  deck.updated = Date.now();
}

export interface Totals {
  cards: number;
  /** What the whole deck costs at market price. */
  total: number;
  /** What the cards you don't own yet cost. */
  toFinish: number;
  /** Cards (copies) with no price, so the totals are a little low. */
  unpriced: number;
}

/** Prices for the deck's zones, or for any other list of entries (e.g. considering). */
export function totals<C extends Card>(deck: Deck, cards: CardIndex<C>, lists: Entry[][] = Object.values(deck.zones)): Totals {
  const t: Totals = { cards: 0, total: 0, toFinish: 0, unpriced: 0 };
  for (const list of lists)
    for (const e of list) {
      t.cards += e.qty;
      const price = cards.get(e.id)?.price;
      if (price == null) {
        t.unpriced += e.qty - e.owned;
        continue;
      }
      t.total += price * e.qty;
      t.toFinish += price * (e.qty - e.owned);
    }
  return t;
}

/** A readable decklist: each zone as a heading, then "3 Card Name" lines. parseTextDeck reads it back. */
export function textList<C extends Card>(game: GameDef<C>, deck: Deck, cards: CardIndex<C>, format: FormatDef): string {
  const parts: string[] = [];
  for (const z of format.zones) {
    const list = deck.zones[z.id] ?? [];
    if (!list.length) continue;
    parts.push([z.name, ...list.map((e) => `${e.qty} ${cards.has(e.id) ? game.label(cards.get(e.id)!) : e.id}`)].join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * The cards still to buy, as a TCGplayer Mass Entry link that opens with the list filled in.
 * Cards TCGplayer doesn't sell (yet) are left out and returned in `unlisted`.
 */
export function massEntry<C extends Card>(game: GameDef<C>, deck: Deck, cards: CardIndex<C>, zones = Object.keys(deck.zones)): { url: string | null; lines: string[]; unlisted: string[] } {
  const need = new Map<string, number>();
  for (const z of zones) for (const e of deck.zones[z] ?? []) if (e.qty > e.owned) need.set(e.id, (need.get(e.id) ?? 0) + e.qty - e.owned);
  const lines: string[] = [];
  const unlisted: string[] = [];
  for (const [id, n] of need) {
    const c = cards.get(id);
    if (game.massEntryById && c?.tcg) lines.push(`${n}-${c.tcg}`);
    else if (c?.tcgName) lines.push(`${n} ${c.tcgName}`);
    else unlisted.push(c ? game.label(c) : id);
  }
  const url = lines.length
    ? `https://www.tcgplayer.com/massentry?productline=${encodeURIComponent(game.tcgProductLine)}&c=${encodeURIComponent(lines.join('||'))}`
    : null;
  return { url, lines, unlisted };
}
