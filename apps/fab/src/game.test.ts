import { describe, expect, it } from 'vitest';
import { addCard, indexCards, newDeck, rehome, setQty } from '@milk/core/deck';
import { start } from '@milk/core/goldfish';
import { formats, game, heroMiss, illegal, maxCopies, type FabCard } from './game';

let n = 0;
const card = (name: string, extra: Partial<FabCard> = {}): FabCard => ({
  id: `F${++n}`,
  name,
  pitch: 1,
  color: 'Red',
  kind: 'Action',
  typeText: 'Generic Action - Attack',
  supertypes: [],
  generic: true,
  subtypes: ['Attack'],
  cost: 1,
  set: 'TST',
  sets: ['TST'],
  bad: {},
  price: 1,
  tcg: 1000 + n,
  ...extra,
});

const cc = formats.find((f) => f.id === 'cc')!;
const blitz = formats.find((f) => f.id === 'blitz')!;
const ll = formats.find((f) => f.id === 'll')!;
const dori = card('Dorinthea Ironsong', { kind: 'Hero', typeText: 'Warrior Hero', supertypes: ['Warrior'], pitch: undefined, color: undefined, health: 40, intellect: 4, bad: { blitz: 'not legal', sa: 'not legal' } });
const young = card('Dorinthea', { kind: 'Hero', typeText: 'Warrior Hero - Young', supertypes: ['Warrior'], young: true, pitch: undefined, color: undefined, health: 20, intellect: 4, bad: { cc: 'not legal', ll: 'not legal' } });
const aurora = card('Aurora, Shooting Star', { kind: 'Hero', supertypes: ['Elemental', 'Runeblade'], essence: ['Lightning'], pitch: undefined, color: undefined, health: 40, intellect: 4 });
const boltyn = card('Boltyn', { kind: 'Hero', supertypes: ['Light', 'Warrior'], young: true, pitch: undefined, color: undefined, health: 20, intellect: 4 });
const snatchR = card('Snatch');
const snatchB = card('Snatch', { pitch: 3, color: 'Blue' });
const warrior = card('Steelblade Supremacy', { supertypes: ['Warrior'], generic: undefined });
const ninja = card('Head Jab', { supertypes: ['Ninja'], generic: undefined });
const spec = card('Glistening Steelblade', { supertypes: ['Warrior'], generic: undefined, specialization: ['Dorinthea'] });
const bolt = card('Lightning Press', { supertypes: ['Lightning'], generic: undefined });
const legendary = card('Crown of Seeds', { kind: 'Equipment', subtypes: ['Head'], legendary: true, pitch: undefined, color: undefined });
const sword = card('Dawnblade', { kind: 'Weapon', typeText: 'Warrior Weapon - Sword (2H)', supertypes: ['Warrior'], subtypes: ['Sword', '(2H)'], pitch: undefined, color: undefined });
const restricted = card('Bonds of Ancestry', { restricted: ['ll'] });
const banned = card('Banned Thing', { bad: { cc: 'banned' } });
const all = [dori, young, aurora, boltyn, snatchR, snatchB, warrior, ninja, spec, bolt, legendary, sword, restricted, banned];
const cards = indexCards({ updated: '', cards: all });

function deckOf(list: [FabCard, number, string?][], format = cc) {
  const d = newDeck(format, 'test');
  for (const [c, q, z] of list) setQty(d, z ?? game.zoneFor(c, format)!, c.id, q);
  return d;
}
const messages = (d: ReturnType<typeof deckOf>, f = cc) => game.validate(d, cards, f).map((i) => i.message);

describe('fab copies and legality', () => {
  it('counts name plus pitch as the unique card, with format, Legendary and restricted limits', () => {
    expect(maxCopies(snatchR, cc)).toBe(3);
    expect(maxCopies(snatchR, blitz)).toBe(1);
    expect(maxCopies(legendary, cc)).toBe(1);
    expect(maxCopies(restricted, ll)).toBe(1);
    expect(maxCopies(restricted, cc)).toBe(3);
    const d = deckOf([[snatchR, 3]]);
    expect(addCard(game, d, cc, snatchB, 'main', cards)).toBeNull(); // blue is a different card
    expect(addCard(game, d, cc, snatchR, 'main', cards)).not.toBeNull();
  });

  it('keeps young heroes out of Classic Constructed and adult heroes out of Blitz', () => {
    expect(illegal(young, cc)).toMatch(/young heroes/);
    expect(illegal(dori, blitz)).toMatch(/adult heroes/);
    expect(illegal(banned, cc)).toBe('banned in Classic Constructed');
    expect(illegal(snatchR, cc)).toBeNull();
  });
});

describe('fab hero fit', () => {
  it('needs the hero classes and talents, Essence talents, and the named hero for Specializations', () => {
    expect(heroMiss(warrior, dori)).toBeNull();
    expect(heroMiss(snatchR, dori)).toBeNull();
    expect(heroMiss(ninja, dori)).toBe('Not Ninja');
    expect(heroMiss(spec, dori)).toBeNull();
    expect(heroMiss(spec, young)).toBeNull();
    expect(heroMiss(spec, aurora)).toBe('Not Warrior');
    expect(heroMiss(spec, boltyn)).toBe('Dorinthea only');
    expect(heroMiss(bolt, aurora)).toBeNull();
    expect(heroMiss(bolt, dori)).toBe('Not Lightning');
    const hybrid = card('A Bit off the Side', { supertypes: ['Guardian', 'Warrior'], hybrid: [['Guardian'], ['Warrior']], generic: undefined });
    expect(heroMiss(hybrid, dori)).toBeNull();
    expect(heroMiss(hybrid, aurora)).toBe('Not Guardian or Warrior');
  });

  it('turns Fits my hero on once a hero is chosen', () => {
    expect(game.fit!.auto!(deckOf([[snatchR, 3]]), cards)).toBe(false);
    expect(game.fit!.auto!(deckOf([[dori, 1], [snatchR, 3]]), cards)).toBe(true);
  });
});

describe('fab validation', () => {
  it('asks for a hero, flags off-class cards and an oversized pool', () => {
    expect(messages(deckOf([[snatchR, 3]]))).toContain('Choose a hero');
    expect(messages(deckOf([[dori, 1], [ninja, 3], [sword, 1]]))).toContainEqual(expect.stringMatching(/^Not Ninja \(hero is Dorinthea Ironsong\): Head Jab \(red\)/));
    const big = deckOf([[dori, 1], [sword, 1], [snatchR, 3], [snatchB, 3, 'side']], blitz);
    expect(messages(big, blitz)).toContainEqual(expect.stringMatching(/Snatch \(red\): 3 copies, max 1/));
    const pool = deckOf([[dori, 1], [sword, 1]]);
    for (let i = 0; i < 27; i++) {
      const c = card(`Filler ${i}`);
      cards.set(c.id, c);
      setQty(pool, 'main', c.id, 3);
    }
    expect(messages(pool)).toContainEqual(expect.stringMatching(/Card pool is 82 cards/));
    expect(game.meters!(pool, cards, cc)[0]).toEqual({ label: 'card pool', value: 82, max: 80 });
  });
});

describe('fab evos', () => {
  it('puts Action and Instant equipment in the deck, and moves them there in older decks', () => {
    const evo = card('Evo Zip Line', { kind: 'Equipment', deckCard: true, pitch: 2, color: 'Yellow', subtypes: ['Evo', 'Legs'], supertypes: ['Mechanologist'], generic: undefined });
    cards.set(evo.id, evo);
    expect(game.zoneFor(evo, cc)).toBe('main');
    expect(game.zoneFor(legendary, cc)).toBe('arena');
    const old = deckOf([[snatchR, 3], [evo, 1, 'arena'], [legendary, 1]]);
    expect(rehome(game, old, cards, cc)).toBe(1);
    expect(old.zones.arena.map((e) => e.id)).toEqual([legendary.id]);
    expect(old.zones.main.map((e) => e.id)).toEqual([snatchR.id, evo.id]);
  });
});

describe('fab deck order', () => {
  it('sorts each group red, yellow, blue, then by name', () => {
    const yellow = card('Apex', { pitch: 2, color: 'Yellow' });
    const sorted = [snatchB, warrior, yellow, snatchR, legendary].sort(game.deckOrder!).map((c) => `${c.name} ${c.color ?? ''}`.trim());
    expect(sorted).toEqual(['Crown of Seeds', 'Snatch Red', 'Steelblade Supremacy Red', 'Apex Yellow', 'Snatch Blue']);
  });
});

describe('fab decklists', () => {
  it('round-trips the Fabrary text format', () => {
    const d = deckOf([[dori, 1], [sword, 1], [snatchR, 3], [snatchB, 2], [warrior, 2, 'side']]);
    const text = game.exportDeck(d, cards);
    expect(text).toContain('Hero: Dorinthea Ironsong');
    expect(text).toContain('3x Snatch (red)');
    expect(text).toContain('Sideboard\n2x Steelblade Supremacy (red)');
    const back = game.importDeck(text, cards, formats);
    expect(back.format).toBe('cc');
    for (const z of ['hero', 'arena', 'main', 'side']) expect(back.zones[z]).toEqual(d.zones[z] ?? []);
  });

  it('guesses Blitz from a young hero and skips unknown lines', () => {
    const back = game.importDeck('Hero: Dorinthea\n1x Dawnblade\n1x Snatch (blue)\n2x Not A Card', cards, formats);
    expect(back.format).toBe('blitz');
    expect(back.zones.main.map((e) => cards.get(e.id)!.color)).toEqual(['Blue']);
    expect(back.skipped).toEqual(['2x Not A Card']);
  });
});

describe('fab goldfish', () => {
  it("draws the hero's intellect and starts life at the hero's health", () => {
    const d = deckOf([[dori, 1], [snatchR, 3], [snatchB, 3]]);
    const f = start(d, game.goldfish!, cards);
    expect(f.hand).toHaveLength(4);
    expect(f.counterStart).toBe(40);
  });
});
