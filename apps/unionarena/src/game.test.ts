import { describe, expect, it } from 'vitest';
import { addCard, indexCards, massEntry, newDeck, setQty } from '@milk/core/deck';
import { formats, game, maxCopies, type UaCard } from './game';

const card = (id: string, extra: Partial<UaCard> = {}): UaCard => ({
  id,
  name: id,
  type: 'Character',
  title: id.split('-')[0],
  series: id.split('-')[0],
  color: 'Purple',
  energy: 1,
  ap: 1,
  rarity: 'Common',
  released: '2025-01-01',
  img: 1,
  price: 1,
  ...extra,
});

const fmt = formats[0];
const csm = Array.from({ length: 13 }, (_, i) => card(`CSM-1-${String(i + 1).padStart(3, '0')}`));
const finals = Array.from({ length: 2 }, (_, i) => card(`CSM-1-${String(i + 50).padStart(3, '0')}`, { trigger: 'Final' }));
const jjk = card('JJK-1-001');
const monarch = card('SLG-1-035', { type: 'Site' });
const asuka = card('EVA-1-051');
const future = card('MHA-1-001', { released: '2026-12-11' });
const cards = indexCards({ updated: '', cards: [...csm, ...finals, jjk, monarch, asuka, future] });
const messages = (d: ReturnType<typeof newDeck>) => game.validate(d, cards, fmt).map((i) => `${i.level}: ${i.message}`);

describe('Union Arena deck rules', () => {
  it('needs exactly 50 cards, all from one series', () => {
    const d = newDeck(fmt, 'test');
    for (const c of csm.slice(0, 12)) setQty(d, 'main', c.id, 4);
    setQty(d, 'main', csm[12].id, 2);
    expect(messages(d)).toEqual([]);
    setQty(d, 'main', jjk.id, 1);
    expect(messages(d)).toContain('error: Not CSM (a deck is one series): JJK-1-001 · JJK-1-001');
    expect(messages(d)).toContain('warning: Too many cards: 51/50. Cut 1');
  });

  it('allows at most 4 Final (and Special, Color) triggers', () => {
    const d = newDeck(fmt, 'test');
    setQty(d, 'main', finals[0].id, 3);
    setQty(d, 'main', finals[1].id, 2);
    expect(messages(d)).toContain('error: 5 cards with a Final trigger, max 4');
  });

  it('applies the restricted list, including future dates', () => {
    expect(maxCopies(asuka)).toBe(1);
    expect(maxCopies(monarch, fmt, '2026-10-31')).toBe(4);
    expect(maxCopies(monarch, fmt, '2026-11-01')).toBe(2);
    expect(maxCopies(csm[0])).toBe(4);
  });

  it('refuses cards before their English release', () => {
    expect(addCard(game, newDeck(fmt, 't'), fmt, future)).toMatch(/not released until/);
  });
});

describe('Union Arena decklists', () => {
  it('round-trips the export and reads full card numbers', () => {
    const d = newDeck(fmt, 'My CSM');
    setQty(d, 'main', csm[0].id, 4);
    const back = game.importDeck(game.exportDeck(d, cards), cards, formats);
    expect(back.name).toBe('My CSM');
    expect(back.zones.main).toEqual([{ id: csm[0].id, qty: 4, owned: 0 }]);
    expect(game.importDeck('4x UE22BT/CSM-1-002\n3 CSM-1-003 Denji', cards, formats).zones.main).toEqual([
      { id: 'CSM-1-002', qty: 4, owned: 0 },
      { id: 'CSM-1-003', qty: 3, owned: 0 },
    ]);
  });

  it('buys by TCGplayer product id', () => {
    const c = card('CSM-1-001', { tcg: 706450 });
    const all = indexCards({ updated: '', cards: [c] });
    const d = newDeck(fmt, 'test');
    setQty(d, 'main', c.id, 4);
    expect(massEntry(game, d, all).lines).toEqual(['4-706450']);
  });
});
