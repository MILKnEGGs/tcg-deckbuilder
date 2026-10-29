import { describe, expect, it } from 'vitest';
import { addCard, indexCards, newDeck, setQty } from '@milk/core/deck';
import { formats, game, maxCopies, type FwCard } from './game';

const card = (id: string, extra: Partial<FwCard> = {}): FwCard => ({
  id,
  name: id,
  type: 'Battle',
  colors: ['Red'],
  cost: 2,
  colorCost: 'R',
  power: 15000,
  combo: 5000,
  traits: [],
  rarity: 'Common',
  set: id.split('-')[0],
  released: '2025-01-01',
  img: 1,
  price: 1,
  ...extra,
});

const fmt = formats[0];
const goku = card('FB01-001', { type: 'Leader', name: 'Son Goku', cost: null, colorCost: '', combo: null, rarity: 'Leader' });
const red = Array.from({ length: 16 }, (_, i) => card(`FB01-${String(i + 10).padStart(3, '0')}`));
const blue = card('FB01-040', { colors: ['Blue'], colorCost: 'U' });
const starter = card('FS05-01');
const roshi = card('FB01-005');
const babidi = card('FB04-085', { colors: ['Black'] });
const metaCooler = card('FB01-131', { text: '[Permanent] You can include as many copies of this card in your deck as you like.' });
const ball = card('FB07-119', { type: 'Extra', text: '[Dragon Ball] (You can include as many copies of cards with [Dragon Ball] in your deck as you like…)' });
const future = card('FB12-001', { released: '2026-12-11' });
const event = card('FP-030', { type: 'Leader', text: 'This card can only be used in specified events.' });
const cards = indexCards({ updated: '', cards: [goku, ...red, blue, starter, roshi, babidi, metaCooler, ball, future, event] });
const messages = (d: ReturnType<typeof newDeck>) => game.validate(d, cards, fmt).map((i) => `${i.level}: ${i.message}`);

function deckOf(n: number) {
  const d = newDeck(fmt, 'test');
  setQty(d, 'leader', goku.id, 1);
  for (const c of red) {
    const q = Math.min(4, n);
    if (q <= 0) break;
    setQty(d, 'main', c.id, q);
    n -= q;
  }
  return d;
}

describe('Fusion World deck rules', () => {
  it('needs a leader and 50 to 60 cards, with no warning in between', () => {
    expect(messages(deckOf(50))).toEqual([]);
    expect(messages(deckOf(60))).toEqual([]);
    expect(messages(deckOf(49))).toContain('error: 49/50 cards: add 1 more');
    expect(messages(deckOf(61))).toContain('error: Too many cards: 61/60. Cut 1');
    const d = deckOf(50);
    setQty(d, 'leader', goku.id, 0);
    expect(messages(d)).toContain('error: Choose a leader');
  });

  it("keeps out colors the leader doesn't have", () => {
    const d = deckOf(50);
    setQty(d, 'main', blue.id, 1);
    expect(messages(d)).toContain("error: Not in Son Goku's color (Red): FB01-040");
    expect(game.fit!.test(blue, d, cards, fmt)).toBe(false);
    expect(game.fit!.test(red[0], d, cards, fmt)).toBe(true);
    expect(game.fit!.auto!(d, cards)).toBe(true);
  });

  it('applies the banned and restricted list and printed limits', () => {
    expect(game.illegal!(roshi, fmt)).toBe('banned');
    expect(maxCopies(babidi)).toBe(1);
    expect(maxCopies(red[0])).toBe(4);
    expect(maxCopies(metaCooler)).toBe(99);
    expect(maxCopies(ball)).toBe(7);
    expect(game.illegal!(event, fmt)).toBe('only for specified events');
    expect(addCard(game, newDeck(fmt, 't'), fmt, future)).toMatch(/not released until/);
  });

  it('allows at most 7 [Dragon Ball] cards', () => {
    const d = deckOf(43);
    setQty(d, 'main', ball.id, 8);
    expect(messages(d)).toContain('error: 8 [Dragon Ball] cards, max 7 in total');
  });

  it('imports lists with or without names and the x', () => {
    const got = game.importDeck('// Goku Red\n1 FB01-001 Son Goku\n4xFB01-010\n3 x FB01-011 Name\nFS05-01\n2 FB99-999 Nobody', cards, formats);
    expect(got.name).toBe('Goku Red');
    expect(got.zones.leader).toEqual([{ id: 'FB01-001', qty: 1, owned: 0 }]);
    expect(got.zones.main).toEqual([
      { id: 'FB01-010', qty: 4, owned: 0 },
      { id: 'FB01-011', qty: 3, owned: 0 },
      { id: 'FS05-01', qty: 1, owned: 0 },
    ]);
    expect(got.skipped).toEqual(['2 FB99-999 Nobody']);
  });
});
