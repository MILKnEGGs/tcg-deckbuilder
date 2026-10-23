import { describe, expect, it } from 'vitest';
import { addCard, indexCards, massEntry, newDeck, setQty } from '@milk/core/deck';
import { formats, game, illegal, type DigiCard } from './game';

const card = (id: string, type: string, extra: Partial<DigiCard> = {}): DigiCard => ({
  id,
  name: id,
  type,
  colors: ['Red'],
  level: type === 'Digimon' ? 3 : type === 'Digi-Egg' ? 2 : null,
  playCost: type === 'Digi-Egg' ? null : 3,
  digiCost: null,
  dp: null,
  traits: [],
  rarity: 'C',
  set: id.replace(/-.*$/, ''),
  released: '2024-01-01',
  price: 1,
  ...extra,
});

const std = formats[0];
const egg = card('BT1-001', 'Digi-Egg');
const mons = Array.from({ length: 13 }, (_, i) => card(`BT2-${String(i + 10).padStart(3, '0')}`, 'Digimon'));
const restricted = card('BT14-033', 'Digimon', { name: 'Patamon' });
const banned = card('BT15-003', 'Digi-Egg', { name: 'Nyaromon' });
const future = card('BT27-001', 'Digimon', { released: '2026-12-11' });
const mother = card('EX2-007', 'Digimon', { name: 'Mother D-Reaper' });
const shoto = card('EX7-064', 'Tamer', { name: 'Shoto Kazama' });
const cards = indexCards({ updated: '', cards: [egg, ...mons, restricted, banned, future, mother, shoto] });
const messages = (d: ReturnType<typeof newDeck>) => game.validate(d, cards, std).map((i) => `${i.level}: ${i.message}`);

describe('Digimon Standard', () => {
  it('needs exactly 50 main deck cards and at most 5 Digi-Eggs', () => {
    const d = newDeck(std, 'test');
    for (const m of mons.slice(0, 12)) setQty(d, 'main', m.id, 4);
    setQty(d, 'main', mons[12].id, 2);
    setQty(d, 'egg', egg.id, 4);
    expect(messages(d)).toEqual([]);
    setQty(d, 'main', mons[12].id, 3);
    expect(messages(d)).toContain('warning: Too many cards: 51/50. Cut 1');
    setQty(d, 'main', mons[12].id, 1);
    expect(messages(d)).toContain('error: 49/50 main deck cards: add 1 more');
  });

  it('puts Digi-Eggs in the egg deck and caps copies at 4, or 1 if restricted', () => {
    const d = newDeck(std, 'test');
    expect(addCard(game, d, std, egg)).toBeNull();
    expect(d.zones.egg).toEqual([{ id: egg.id, qty: 1, owned: 0 }]);
    for (let i = 0; i < 3; i++) addCard(game, d, std, mons[0]);
    expect(addCard(game, d, std, mons[0])).toBeNull();
    expect(addCard(game, d, std, mons[0])).toMatch(/Max 4/);
    expect(addCard(game, d, std, restricted)).toBeNull();
    expect(addCard(game, d, std, restricted)).toMatch(/Only 1/);
  });

  it('refuses banned and unreleased cards', () => {
    expect(illegal(banned, std)).toBe('banned');
    expect(illegal(future, std, '2026-12-10')).toMatch(/not released in English/);
    expect(illegal(future, std, '2026-12-11')).toBeNull();
    expect(addCard(game, newDeck(std, 't'), std, banned)).toMatch(/banned/);
  });

  it('flags banned pairs', () => {
    const d = newDeck(std, 'test');
    setQty(d, 'main', mother.id, 1);
    expect(messages(d).some((m) => m.includes('Banned pair'))).toBe(false);
    setQty(d, 'main', shoto.id, 1);
    expect(messages(d)).toContain("error: Banned pair: Mother D-Reaper · EX2-007 can't be in a deck with Shoto Kazama · EX7-064");
  });
});

describe('Digimon decklists', () => {
  it('round-trips the text export and reads Tabletop Simulator JSON', () => {
    const d = newDeck(std, 'My deck');
    setQty(d, 'egg', egg.id, 4);
    setQty(d, 'main', mons[0].id, 3);
    const back = game.importDeck(game.exportDeck(d, cards), cards, formats);
    expect(back.name).toBe('My deck');
    expect(back.zones).toEqual({ egg: [{ id: egg.id, qty: 4, owned: 0 }], main: [{ id: mons[0].id, qty: 3, owned: 0 }] });

    const tts = game.importDeck(JSON.stringify(['Exported from digimoncard.io', 'BT1-001', 'BT1-001', 'BT2-010', 'XX9-999']), cards, formats);
    expect(tts.zones.egg).toEqual([{ id: 'BT1-001', qty: 2, owned: 0 }]);
    expect(tts.zones.main).toEqual([{ id: 'BT2-010', qty: 1, owned: 0 }]);
  });

  it('names the exact printing for TCGplayer Mass Entry', () => {
    const c = card('BT11-046', 'Digimon', { name: 'Agumon', tcgName: 'Agumon', tcgSet: 'BT-11', tcgNum: 'BT11-046' });
    const all = indexCards({ updated: '', cards: [c] });
    const d = newDeck(std, 'test');
    setQty(d, 'main', c.id, 2);
    expect(massEntry(game, d, all).lines).toEqual(['2 Agumon [BT-11] BT11-046']);
  });
});
