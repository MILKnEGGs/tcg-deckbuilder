// Test helper (used by each app's roundtrip.test.ts, never by app code): builds random decks from a game's
// real card list and checks that Copy decklist → Import gives back the same deck, description included,
// since that's how people share decks between copies of the app.

import { describe, expect, it } from 'vitest';
import { addCard, indexCards, newDeck } from './deck';
import { addConsidering, takeConsidering } from './considering';
import { addDescription, takeDescription } from './description';
import type { Card, CardData, CardIndex, Deck, FormatDef, GameDef } from './types';

/** Small seeded random numbers, so a failure can be rerun exactly. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deck of random cards for every zone of the format, as many copies as the rules allow (up to 3). */
export function randomDeck<C extends Card>(game: GameDef<C>, cards: C[], index: CardIndex<C>, format: FormatDef, seed: number): Deck {
  const random = rng(seed);
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const deck = newDeck(format, `Round trip ${format.name} ${seed}`);
  const usable = cards.filter((c) => !game.illegal?.(c, format));
  for (const z of format.zones) {
    const home = z.id === 'side' ? 'main' : z.id;
    const pool = usable.filter((c) => game.zoneFor(c, format) === home);
    if (!pool.length) continue;
    const distinct = z.command ? Math.min(z.max, 2) : z.id === 'main' ? 25 : 4;
    for (let i = 0; i < distinct * 3; i++) {
      const c = pick(pool);
      const copies = 1 + Math.floor(random() * 3);
      for (let k = 0; k < copies; k++) if (addCard(game, deck, format, c, z.id, index)) break;
      if ((deck.zones[z.id] ?? []).length >= distinct) break;
    }
  }
  return deck;
}

/** Each zone as sorted "id×qty" strings, with ids resolved to the card they belong to. */
const shape = (zones: Record<string, { id: string; qty: number }[]>, index: CardIndex<Card>) =>
  Object.fromEntries(
    Object.entries(zones)
      .map(([z, list]) => {
        const qty = new Map<string, number>();
        for (const e of list) {
          const id = index.get(e.id)?.id ?? e.id;
          qty.set(id, (qty.get(id) ?? 0) + e.qty);
        }
        return [z, [...qty].map(([id, n]) => `${id}×${n}`).sort()] as const;
      })
      .filter(([, list]) => list.length),
  );

/** ROUNDTRIP_DECKS=250 npm test runs a bigger sweep. */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Registers the round-trip tests for a game. They run against the downloaded card list (pass what
 * import.meta.glob found for public/data/cards.json) and are skipped where it hasn't been downloaded.
 */
export function roundTripSuite<C extends Card>(game: GameDef<C>, found: Record<string, unknown>, decksPerFormat = Number(env.ROUNDTRIP_DECKS) || 4) {
  const data = Object.values(found)[0] as CardData<C> | undefined;
  describe.skipIf(!data)(`${game.game}: Copy decklist → Import with real cards`, () => {
    if (!data) return;
    const index = indexCards(data);
    for (const format of game.formats)
      for (let seed = 1; seed <= decksPerFormat; seed++)
        it(`${format.name} deck ${seed}`, () => {
          const deck = randomDeck(game, data.cards, index, format, seed);
          deck.description = `How to play deck ${seed}:\n\nMulligan for your best opener.\nDescription: lines like this one stay in the text.`;
          // A few maybes, from anywhere in the card list.
          const extra = randomDeck(game, data.cards, index, format, seed + 1000);
          deck.considering = Object.values(extra.zones).flat().slice(0, 5).map((e) => ({ ...e, qty: Math.min(e.qty, 2), owned: 0 }));
          const shared = addDescription(addConsidering(game.exportDeck(deck, index), deck, game, index), deck.description);
          const { text, description } = takeDescription(shared);
          const maybe = takeConsidering(text, game, index, game.formats[0]);
          const back = game.importDeck(maybe.text, index, game.formats);
          expect([...back.skipped, ...maybe.skipped], 'lines the import did not recognise').toEqual([]);
          expect(shape(back.zones, index as CardIndex<Card>)).toEqual(shape(deck.zones, index as CardIndex<Card>));
          expect(shape({ considering: maybe.considering ?? [] }, index as CardIndex<Card>)).toEqual(shape({ considering: deck.considering }, index as CardIndex<Card>));
          expect(description).toBe(deck.description);
        });
  });
}
