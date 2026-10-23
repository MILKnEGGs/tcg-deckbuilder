import { describe, expect, it } from 'vitest';
import { addCard, indexCards, massEntry, newDeck, setQty } from '@milk/core/deck';
import { formats, game, illegal, type OpCard } from './game';

const card = (id: string, type: string, colors: string[], extra: Partial<OpCard> = {}): OpCard => ({
  id,
  name: id,
  type,
  colors,
  cost: type === 'Leader' ? null : 2,
  power: 3000,
  counter: type === 'Character' ? 1000 : null,
  life: type === 'Leader' ? 4 : null,
  traits: [],
  rarity: 'C',
  set: id.replace(/-.*$/, ''),
  released: '2025-01-01',
  img: 1,
  price: 1,
  ...extra,
});

const standard = formats.find((f) => f.id === 'standard')!;
const extra = formats.find((f) => f.id === 'extra')!;
const leader = card('OP05-001', 'Leader', ['Red', 'Black']);
const red = Array.from({ length: 13 }, (_, i) => card(`OP05-${String(i + 10).padStart(3, '0')}`, 'Character', ['Red']));
const black = card('OP05-090', 'Event', ['Black']);
const green = card('OP05-030', 'Character', ['Green']);
const redGreen = card('OP06-010', 'Character', ['Red', 'Green']);
const oldCard = card('OP01-016', 'Character', ['Red'], { rotated: true });
const banned = card('OP06-086', 'Character', ['Black']);
const promo = card('P-001', 'Character', ['Red'], { notLegal: true });
const cards = indexCards({ updated: '', cards: [leader, ...red, black, green, redGreen, oldCard, banned, promo] });
const messages = (d: ReturnType<typeof newDeck>, f = standard) => game.validate(d, cards, f).map((i) => `${i.level}: ${i.message}`);

describe('One Piece deck rules', () => {
  it('needs a leader and exactly 50 cards in its colors', () => {
    const d = newDeck(standard, 'test');
    setQty(d, 'leader', leader.id, 1);
    for (const c of red.slice(0, 12)) setQty(d, 'main', c.id, 4);
    setQty(d, 'main', black.id, 2);
    expect(messages(d)).toEqual([]);
    setQty(d, 'main', green.id, 1);
    expect(messages(d)).toContain(`error: Not in OP05-001's colors (Red/Black): OP05-030`);
    expect(messages(d)).toContain('warning: Too many cards: 51/50. Cut 1');
  });

  it('rejects a two-color card unless the leader has both colors', () => {
    const d = newDeck(standard, 'test');
    setQty(d, 'leader', leader.id, 1);
    setQty(d, 'main', redGreen.id, 1);
    expect(messages(d).some((m) => m.includes('OP06-010'))).toBe(true);
  });

  it('keeps Block 1 cards out of Standard but allows them in Extra Regulation', () => {
    expect(illegal(oldCard, standard)).toMatch(/rotated/);
    expect(illegal(oldCard, extra)).toBeNull();
    expect(addCard(game, newDeck(standard, 't'), standard, oldCard)).toMatch(/rotated/);
    expect(addCard(game, newDeck(extra, 't'), extra, oldCard)).toBeNull();
  });

  it('refuses banned and not-tournament-legal cards in every format', () => {
    for (const f of formats) {
      expect(illegal(banned, f)).toBe('banned');
      expect(illegal(promo, f)).toBe('not tournament legal');
    }
  });

  it('caps copies at 4 per card number and the leader at 1', () => {
    const d = newDeck(standard, 'test');
    for (let i = 0; i < 4; i++) expect(addCard(game, d, standard, red[0])).toBeNull();
    expect(addCard(game, d, standard, red[0])).toMatch(/Max 4/);
  });

  it('lets "any number of this card" cards (Pacifista) go past 4', () => {
    const pacifista = card('OP16-042', 'Character', ['Red'], { text: 'Under the rules of this game, you may have any number of this card in your deck.' });
    expect(game.maxCopies(pacifista, standard)).toBe(99);
  });
});

describe('One Piece decklists', () => {
  it('round-trips the OPTCGSim format and spots Extra-only lists', () => {
    const d = newDeck(standard, 'test');
    setQty(d, 'leader', leader.id, 1);
    setQty(d, 'main', red[0].id, 4);
    const text = game.exportDeck(d, cards);
    expect(text).toBe('1xOP05-001\n4xOP05-010');
    const back = game.importDeck(text, cards, formats);
    expect(back.format).toBe('standard');
    expect(back.zones).toEqual({ leader: [{ id: leader.id, qty: 1, owned: 0 }], main: [{ id: red[0].id, qty: 4, owned: 0 }] });
    expect(game.importDeck('1xOP05-001\n4xOP01-016', cards, formats).format).toBe('extra');
  });

  it('buys by TCGplayer product id', () => {
    const c = card('OP05-007', 'Character', ['Red'], { tcg: 527009 });
    const all = indexCards({ updated: '', cards: [c] });
    const d = newDeck(standard, 'test');
    setQty(d, 'main', c.id, 3);
    expect(massEntry(game, d, all).lines).toEqual(['3-527009']);
  });
});
