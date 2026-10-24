import { describe, expect, it } from 'vitest';
import { addCard, indexCards, massEntry, newDeck, setQty } from '@milk/core/deck';
import { deckInks, formats, game, illegal, maxCopies, type LorCard } from './game';

let n = 0;
const card = (name: string, inks: string[], extra: Partial<LorCard> = {}): LorCard => ({
  id: `L${++n}`,
  name,
  version: 'Test',
  type: 'Character',
  inks,
  inkable: true,
  cost: 2,
  strength: 2,
  willpower: 2,
  lore: 1,
  moveCost: null,
  classifications: [],
  rarity: 'Common',
  set: '10',
  sets: ['10'],
  released: '2025-11-07',
  core: 'legal',
  infinity: 'legal',
  price: 1,
  ...extra,
});

const core = formats.find((f) => f.id === 'core')!;
const infinity = formats.find((f) => f.id === 'infinity')!;
const amber = Array.from({ length: 8 }, (_, i) => card(`Amber ${i}`, ['Amber']));
const steel = Array.from({ length: 7 }, (_, i) => card(`Steel ${i}`, ['Steel'], { inkable: i > 2 }));
const ruby = card('Ruby Card', ['Ruby']);
const dualAS = card('Dual Amber Steel', ['Amber', 'Steel']);
const dualAR = card('Dual Amber Ruby', ['Amber', 'Ruby']);
const old = card('Old Card', ['Amber'], { core: 'not_legal' });
const banned = card('Fortisphere', ['Steel'], { core: 'banned' });
const puppy = card('Dalmatian Puppy', ['Amber'], { text: 'WHERE DID THEY ALL COME FROM? You may have up to 99 copies of Dalmatian Puppy - Tail Wagger in your deck.' });
const microbots = card('Microbots', ['Sapphire'], { text: 'LIMITLESS APPLICATIONS You may have any number of cards named Microbots in your deck.' });
const cards = indexCards({ updated: '', cards: [...amber, ...steel, ruby, dualAS, dualAR, old, banned, puppy, microbots] });
const messages = (d: ReturnType<typeof newDeck>, f = core) => game.validate(d, cards, f).map((i) => `${i.level}: ${i.message}`);

function amberSteel() {
  const d = newDeck(core, 'test');
  for (const c of [...amber, ...steel]) setQty(d, 'main', c.id, 4);
  return d;
}

describe('Lorcana deck rules', () => {
  it('accepts 60 cards in two inks and counts inkable cards', () => {
    const d = amberSteel();
    expect(messages(d)).toEqual([]);
    expect(game.meters!(d, cards, core)).toEqual([{ label: 'inkable', value: 48, max: 60 }]);
  });

  it('allows at most two inks, counting both inks of a dual-ink card', () => {
    const d = amberSteel();
    setQty(d, 'main', dualAS.id, 1);
    expect(deckInks(d, cards)).toEqual(['Amber', 'Steel']);
    expect(messages(d).some((m) => m.includes('inks'))).toBe(false);
    setQty(d, 'main', dualAR.id, 1);
    expect(deckInks(d, cards)).toEqual(['Amber', 'Ruby', 'Steel']);
    expect(messages(d)).toContain('error: 3 inks: Amber, Ruby, Steel. Decks can use 2; outside Amber/Steel: Dual Amber Ruby - Test');
  });

  it('caps copies at 4 except cards that say otherwise', () => {
    const d = newDeck(core, 'test');
    for (let i = 0; i < 4; i++) expect(addCard(game, d, core, amber[0])).toBeNull();
    expect(addCard(game, d, core, amber[0])).toMatch(/Max 4/);
    expect(maxCopies(puppy)).toBe(99);
    expect(maxCopies(microbots)).toBe(99);
  });

  it('follows each format’s legality and bans', () => {
    expect(illegal(old, core)).toBe('not in a Core-legal set');
    expect(illegal(old, infinity)).toBeNull();
    expect(illegal(banned, core)).toBe('banned in Core');
    expect(illegal(banned, infinity)).toBeNull();
    expect(illegal(card('Future', ['Amber'], { released: '2099-01-01' }), core)).toMatch(/not released/);
  });

  it('filters search to cards that keep the deck at two inks', () => {
    const d = amberSteel();
    expect(game.fit!.test(dualAS, d, cards, core)).toBe(true);
    expect(game.fit!.test(ruby, d, cards, core)).toBe(false);
    expect(game.fit!.test(ruby, newDeck(core, 'empty'), cards, core)).toBe(true);
  });

  it('only lets inkable cards into the goldfish inkwell', () => {
    expect(game.goldfish!.canResource!(steel[0])).toBe(false);
    expect(game.goldfish!.canResource!(amber[0])).toBe(true);
  });
});

describe('Lorcana decklists', () => {
  it('round-trips "4 Name - Version" lists', () => {
    const d = amberSteel();
    const back = game.importDeck(game.exportDeck(d, cards), cards, formats);
    expect(back.zones.main?.reduce((s, e) => s + e.qty, 0)).toBe(60);
    expect(back.skipped).toEqual([]);
  });

  it('buys by TCGplayer product id', () => {
    const c = card('Buy Me', ['Amber'], { tcg: 722351 });
    const idx = indexCards({ updated: '', cards: [c] });
    const d = newDeck(core, 't');
    setQty(d, 'main', c.id, 4);
    expect(massEntry(game, d, idx).lines).toEqual(['4-722351']);
  });
});
