import { describe, expect, it } from 'vitest';
import { addCard, indexCards, newDeck, setQty } from '@milk/core/deck';
import { aspectPenalty, formats, game, type SwuCard } from './game';

const card = (id: string, type: string, aspects: string[], extra: Partial<SwuCard> = {}): SwuCard => ({
  id,
  name: id,
  type,
  aspects,
  traits: [],
  arenas: type === 'Unit' ? ['Ground'] : [],
  cost: 2,
  power: null,
  hp: null,
  unique: false,
  rarity: 'Common',
  set: 'SOR',
  price: 1,
  ...extra,
});

const heroA = card('HERO_A', 'Leader', ['Vigilance', 'Heroism']);
const heroB = card('HERO_B', 'Leader', ['Command', 'Heroism']);
const villain = card('VILLAIN', 'Leader', ['Aggression', 'Villainy']);
const base = card('BASE', 'Base', ['Command']);
const units = Array.from({ length: 70 }, (_, i) => card(`U${i}`, 'Unit', ['Vigilance']));
const event = card('EVENT', 'Event', ['Command', 'Command']);
const cards = indexCards({ updated: '', cards: [heroA, heroB, villain, base, ...units, event] });
const fmt = (id: string) => formats.find((f) => f.id === id)!;
const messages = (deckFormat: string, d = deck) => game.validate(d, cards, fmt(deckFormat)).map((i) => `${i.level}: ${i.message}`);

let deck = newDeck(fmt('order66'), 'test');

describe('Order 66', () => {
  const o66 = fmt('order66');

  it('counts leaders and base toward 66 and warns when over', () => {
    deck = newDeck(o66, 'test');
    setQty(deck, 'leader', 'HERO_A', 1);
    setQty(deck, 'leader', 'HERO_B', 1);
    setQty(deck, 'base', 'BASE', 1);
    for (const u of units.slice(0, 60)) setQty(deck, 'main', u.id, 1);
    setQty(deck, 'main', 'EVENT', 3);
    expect(messages('order66').filter((m) => m.startsWith('error'))).toEqual([]);

    setQty(deck, 'main', 'U60', 1);
    expect(messages('order66')).toContain('warning: Too many cards: 67/66. Cut 1');
    setQty(deck, 'main', 'U60', 0);
    setQty(deck, 'main', 'U59', 0);
    expect(messages('order66')).toContain('error: 65/66 cards: add 1 more');
  });

  it('allows 1 of each unit but 3 of each event', () => {
    const d = newDeck(o66, 'test');
    expect(addCard(game, d, o66, units[0])).toBeNull();
    expect(addCard(game, d, o66, units[0])).toMatch(/Only 1/);
    for (let i = 0; i < 3; i++) expect(addCard(game, d, o66, event)).toBeNull();
    expect(addCard(game, d, o66, event)).toMatch(/Max 3/);
  });

  it('lets you go up to 150 cards before stopping', () => {
    const d = newDeck(o66, 'test');
    setQty(d, 'leader', 'HERO_A', 1);
    setQty(d, 'leader', 'HERO_B', 1);
    setQty(d, 'base', 'BASE', 1);
    setQty(d, 'main', 'EVENT', 147);
    expect(addCard(game, d, o66, units[0])).toMatch(/full/);
  });

  it('requires both leaders to share Heroism or Villainy', () => {
    const d = newDeck(o66, 'test');
    setQty(d, 'leader', 'HERO_A', 1);
    setQty(d, 'leader', 'VILLAIN', 1);
    expect(messages('order66', d)).toContain('error: Both leaders must share Heroism or Villainy');
  });
});

describe('aspects', () => {
  it('charges 2 per icon the leaders and base do not provide, counting repeats', () => {
    expect(aspectPenalty(event, ['Command'])).toBe(2);
    expect(aspectPenalty(event, ['Command', 'Command'])).toBe(0);
    expect(aspectPenalty(event, ['Vigilance'])).toBe(4);
    expect(aspectPenalty(card('X', 'Unit', []), [])).toBe(0);
  });

  it('reports the penalty as a warning', () => {
    const d = newDeck(fmt('premier'), 'test');
    setQty(d, 'leader', 'VILLAIN', 1);
    setQty(d, 'base', 'BASE', 1);
    setQty(d, 'main', 'U0', 3);
    expect(messages('premier', d)).toContain('warning: Aspect penalty on 3 cards: U0 (+2)');
  });
});

describe('decklists', () => {
  it('round-trips the SWUDB JSON format and guesses Order 66', () => {
    const back = game.importDeck(game.exportDeck(deck, cards), cards, formats);
    expect(back.format).toBe('order66');
    expect(back.zones.leader.map((e) => e.id)).toEqual(['HERO_A', 'HERO_B']);
    expect(back.zones.main.reduce((n, e) => n + e.qty, 0)).toBe(62);
    expect(back.skipped).toEqual([]);
  });

  it('reads plain text lists', () => {
    const r = game.importDeck('Leader\n1 HERO_A\n\nDeck\n3x EVENT\n2 Nope', cards, formats);
    expect(r.zones.leader).toEqual([{ id: 'HERO_A', qty: 1, owned: 0 }]);
    expect(r.zones.main).toEqual([{ id: 'EVENT', qty: 3, owned: 0 }]);
    expect(r.skipped).toEqual(['2 Nope']);
  });
});
