import { describe, expect, it } from 'vitest';
import { addCard, changeFormat, considerToDeck, cycleOwned, deckToConsider, indexCards, massEntry, newDeck, setConsidering, setQty, totals } from './deck';
import { sizeIssues } from './rules';
import type { Card, FormatDef, GameDef } from './types';

const format: FormatDef = {
  id: 'std',
  name: 'Standard',
  summary: '',
  zones: [
    { id: 'main', name: 'Deck', max: 6 },
    { id: 'side', name: 'Sideboard', max: 3 },
  ],
  size: { zones: ['main'], target: 4 },
};
const single: FormatDef = { ...format, id: 'one', zones: [{ id: 'main', name: 'Deck', max: 6 }] };

const game = {
  label: (c: Card) => c.name,
  zoneFor: () => 'main',
  maxCopies: () => 2,
  tcgProductLine: 'Test Game',
} as unknown as GameDef<Card>;

const data = {
  updated: '',
  cards: [
    { id: 'A_1', name: 'Alpha', price: 1.5, alt: ['B_9'], tcgName: 'Alpha - TCG' },
    { id: 'A_2', name: 'Beta', price: null, tcgName: 'Beta' },
    { id: 'A_3', name: 'Gamma', price: 10 },
  ],
};
const cards = indexCards(data);
const [alpha, beta, gamma] = data.cards;

describe('deck', () => {
  it('resolves other printings to the same card', () => {
    expect(cards.get('B_9')).toBe(alpha);
  });

  it('caps copies and the zone hard cap', () => {
    const d = newDeck(format, 'test');
    expect(addCard(game, d, format, alpha)).toBeNull();
    expect(addCard(game, d, format, alpha)).toBeNull();
    expect(addCard(game, d, format, alpha)).toMatch(/Max 2/);
    addCard(game, d, format, beta);
    addCard(game, d, format, beta);
    addCard(game, d, format, gamma);
    addCard(game, d, format, gamma);
    expect(addCard(game, d, format, { id: 'X', name: 'X', price: 0 })).toMatch(/full/);
  });

  it('warns, not errors, when over the target size', () => {
    const d = newDeck(format, 'test');
    setQty(d, 'main', 'A_1', 3);
    expect(sizeIssues(d, format)[0].level).toBe('error');
    setQty(d, 'main', 'A_2', 2);
    expect(sizeIssues(d, format)[0].level).toBe('warning');
  });

  it('prices the deck and what is left to buy', () => {
    const d = newDeck(format, 'test');
    setQty(d, 'main', 'A_1', 2);
    setQty(d, 'main', 'A_2', 1);
    setQty(d, 'side', 'A_3', 1);
    cycleOwned(d, 'main', 'A_1');
    const t = totals(d, cards);
    expect(t.total).toBeCloseTo(13);
    expect(t.toFinish).toBeCloseTo(11.5);
    expect(t.unpriced).toBe(1);
  });

  it('builds a filled-in TCGplayer Mass Entry link from exact TCGplayer names', () => {
    const d = newDeck(format, 'test');
    setQty(d, 'main', 'A_1', 2);
    setQty(d, 'main', 'A_2', 1);
    setQty(d, 'side', 'A_3', 1);
    cycleOwned(d, 'main', 'A_2');
    const m = massEntry(game, d, cards);
    expect(m.lines).toEqual(['2 Alpha - TCG']);
    expect(m.unlisted).toEqual(['Gamma']);
    expect(m.url).toBe('https://www.tcgplayer.com/massentry?productline=Test%20Game&c=2%20Alpha%20-%20TCG');
  });

  it('moves cards between the deck and Considering, keeping owned copies', () => {
    const d = newDeck(format, 'test');
    setConsidering(d, 'A_1', 2);
    expect(considerToDeck(game, d, format, alpha)).toBeNull();
    expect(d.zones.main).toEqual([{ id: 'A_1', qty: 1, owned: 0 }]);
    expect(d.considering).toEqual([{ id: 'A_1', qty: 1, owned: 0 }]);
    setQty(d, 'main', 'A_1', 2);
    expect(considerToDeck(game, d, format, alpha)).toMatch(/Max 2/);

    cycleOwned(d, 'main', 'A_1');
    cycleOwned(d, 'main', 'A_1');
    deckToConsider(d, 'main', 'A_1');
    expect(d.zones.main).toEqual([{ id: 'A_1', qty: 1, owned: 1 }]);
    expect(d.considering).toEqual([{ id: 'A_1', qty: 2, owned: 1 }]);
    // Considering never counts toward the deck's price.
    expect(totals(d, cards).cards).toBe(1);
  });

  it('owned cycles through the copies and back to none', () => {
    const d = newDeck(format, 'test');
    setQty(d, 'main', 'A_1', 2);
    const e = d.zones.main[0];
    cycleOwned(d, 'main', 'A_1');
    cycleOwned(d, 'main', 'A_1');
    expect(e.owned).toBe(2);
    cycleOwned(d, 'main', 'A_1');
    expect(e.owned).toBe(0);
    cycleOwned(d, 'main', 'A_1');
    setQty(d, 'main', 'A_1', 0);
    expect(d.zones.main).toHaveLength(0);
  });

  it('folds zones the new format lacks into the main deck', () => {
    const d = newDeck(format, 'test');
    setQty(d, 'main', 'A_1', 1);
    setQty(d, 'side', 'A_1', 1);
    setQty(d, 'side', 'A_3', 1);
    changeFormat(d, format, single);
    expect(d.format).toBe('one');
    expect(d.zones.side).toBeUndefined();
    expect(d.zones.main.map((e) => [e.id, e.qty])).toEqual([
      ['A_1', 2],
      ['A_3', 1],
    ]);
  });
});
