import { describe, expect, it } from 'vitest';
import { addCard, indexCards, massEntry, newDeck, setQty } from '@milk/core/deck';
import { faceLabel, formats, game, illegal, pointsUsed, teamPoints, type SwdCard } from './game';

let n = 0;
const card = (name: string, type: string, affiliation: SwdCard['affiliation'], color: SwdCard['color'], extra: Partial<SwdCard> = {}): SwdCard => ({
  id: `T${++n}`,
  name,
  type,
  affiliation,
  color,
  subtypes: [],
  unique: false,
  cost: type === 'character' ? null : 1,
  health: type === 'character' ? 10 : null,
  limit: 2,
  rarity: 'C',
  set: 'AW',
  sets: ['AW'],
  img: '',
  legal: formats.map((f) => f.id),
  price: 1,
  ...extra,
});

const arh = formats.find((f) => f.id === 'ARHS')!;
const inf = formats.find((f) => f.id === 'INF')!;
const leia = card('Leia Organa', 'character', 'hero', 'yellow', { unique: true, points: '12/16', text: 'You can include up to 5 Red villain cards in your deck.' });
const han = card('Han Solo', 'character', 'hero', 'red', { unique: true, points: '14/18', balance: { ARHS: '13/17' } });
const trooper = card('Rebel Trooper', 'character', 'hero', 'red', { points: '6' });
const vader = card('Darth Vader', 'character', 'villain', 'red', { unique: true, points: '16/21' });
const leia2 = card('Leia Organa', 'character', 'hero', 'red', { unique: true, points: '10/14', sub: 'Senator' });
const battlefield = card('Echo Base', 'battlefield', 'neutral', 'gray');
const redHero = Array.from({ length: 15 }, (_, i) => card(`Red Hero Card ${i}`, 'event', 'hero', 'red'));
const blueHero = card('Blue Hero Card', 'event', 'hero', 'blue');
const redVillain = card('Red Villain Card', 'upgrade', 'villain', 'red');
const yellowVillain = card('Yellow Villain Card', 'upgrade', 'villain', 'yellow');
const restrictedA = card('Restricted A', 'event', 'neutral', 'gray', { restricted: ['ARHS'] });
const restrictedB = card('Restricted B', 'event', 'neutral', 'gray', { restricted: ['ARHS'] });
const pairA = card('Pair A', 'event', 'neutral', 'gray');
const pairB = card('Pair B', 'event', 'neutral', 'gray');
pairA.pairs = { ARHS: [pairB.id] };
pairB.pairs = { ARHS: [pairA.id] };
const old = card('Old Card', 'event', 'neutral', 'gray', { legal: ['INF'] });
const all = [leia, han, trooper, vader, leia2, battlefield, ...redHero, blueHero, redVillain, yellowVillain, restrictedA, restrictedB, pairA, pairB, old];
const cards = indexCards({ updated: '', cards: all });
const messages = (d: ReturnType<typeof newDeck>, f = arh) => game.validate(d, cards, f).map((i) => `${i.level}: ${i.message}`);

function legalDeck() {
  const d = newDeck(arh, 'test');
  setQty(d, 'team', leia.id, 1); // 12
  setQty(d, 'team', han.id, 1); // 13 in ARH Standard
  setQty(d, 'battlefield', battlefield.id, 1);
  for (const c of redHero) setQty(d, 'main', c.id, 2);
  return d;
}

describe('Destiny team', () => {
  it('prices elite dice and applies the format’s point changes', () => {
    expect(teamPoints(leia, 1, arh)).toBe(12);
    expect(teamPoints(leia, 2, arh)).toBe(16);
    expect(teamPoints(han, 1, arh)).toBe(13);
    expect(teamPoints(han, 1, inf)).toBe(14);
    expect(teamPoints(trooper, 3, arh)).toBe(18);
  });

  it('accepts a legal deck and caps the team at 30 points', () => {
    const d = legalDeck();
    expect(messages(d)).toEqual([]);
    setQty(d, 'team', leia.id, 2); // elite: 16 + 13 = 29
    expect(pointsUsed(d, cards, arh)).toBe(29);
    setQty(d, 'team', trooper.id, 1); // 35
    expect(messages(d)).toContain('error: Team is 35/30 points. Cut 5');
  });

  it('keeps heroes and villains apart and allows one of each unique title', () => {
    const d = legalDeck();
    setQty(d, 'team', vader.id, 1);
    expect(messages(d)).toContain("error: Heroes and villains can't be on the same team");
    setQty(d, 'team', vader.id, 0);
    setQty(d, 'team', leia2.id, 1);
    expect(messages(d)).toContain('error: Only one Leia Organa can be on a team');
  });

  it('lets a unique character go elite (2 dice) but no further', () => {
    const d = newDeck(arh, 'test');
    expect(addCard(game, d, arh, leia)).toBeNull();
    expect(addCard(game, d, arh, leia)).toBeNull();
    expect(addCard(game, d, arh, leia)).toMatch(/Max 2/);
    expect(game.qtyLabel!(leia, 2)).toBe('Elite');
  });
});

describe('Destiny deck', () => {
  it('needs a battlefield and exactly 30 cards', () => {
    const d = legalDeck();
    setQty(d, 'battlefield', battlefield.id, 0);
    setQty(d, 'main', redHero[0].id, 1);
    expect(messages(d)).toEqual(expect.arrayContaining(['error: Choose a battlefield', 'error: 29/30 cards: add 1 more']));
  });

  it('needs a matching color and affiliation, with printed exceptions and their limits', () => {
    const d = legalDeck();
    setQty(d, 'main', redHero[0].id, 1);
    setQty(d, 'main', blueHero.id, 1);
    expect(messages(d)).toContain("error: Your team can't include: Blue Hero Card (blue)");
    setQty(d, 'main', blueHero.id, 0);
    // Leia allows up to 5 Red villain cards; yellow villain cards are still out.
    setQty(d, 'main', redVillain.id, 1);
    expect(messages(d)).toEqual([]);
    setQty(d, 'main', yellowVillain.id, 1);
    expect(messages(d)).toContain("error: Your team can't include: Yellow Villain Card (villain)");
  });

  it('allows only one restricted card and no restricted pairs', () => {
    const d = legalDeck();
    setQty(d, 'main', redHero[0].id, 0);
    setQty(d, 'main', restrictedA.id, 1);
    setQty(d, 'main', restrictedB.id, 1);
    expect(messages(d)).toContain('error: Only one restricted card per deck: Restricted A, Restricted B');
    setQty(d, 'main', restrictedB.id, 0);
    setQty(d, 'main', restrictedA.id, 0);
    setQty(d, 'main', pairA.id, 1);
    setQty(d, 'main', pairB.id, 1);
    expect(messages(d)).toContain("error: Restricted pair: Pair A and Pair B can't be in the same deck");
  });

  it('checks each format’s legal sets', () => {
    expect(illegal(old, arh)).toBe('not legal in ARH Standard');
    expect(illegal(old, inf)).toBeNull();
  });
});

describe('Destiny dice and lists', () => {
  it('reads die faces', () => {
    expect(faceLabel('2RD1')).toBe('2 Ranged (cost 1)');
    expect(faceLabel('+1MD')).toBe('+1 Melee');
    expect(faceLabel('1Dc')).toBe('1 Discard');
    expect(faceLabel('Sp')).toBe('Special');
    expect(faceLabel('-')).toBe('Blank');
  });

  it('rolls one die per character die (two for elites)', () => {
    const elite = { ...leia, sides: ['1RD', '2RD', '1F', '1Dc', '1R', '-'] };
    const idx = indexCards({ updated: '', cards: [elite] });
    const d = newDeck(arh, 't');
    setQty(d, 'team', elite.id, 2);
    const dice = game.goldfish!.dice!(d, idx);
    expect(dice.map((x) => x.name)).toEqual(['Leia Organa (1)', 'Leia Organa (2)']);
    expect(dice[0].faces).toContain('2 Ranged');
  });

  it('round-trips the text export, elites included', () => {
    const d = legalDeck();
    setQty(d, 'team', leia.id, 2);
    const back = game.importDeck(game.exportDeck(d, cards), cards, formats);
    expect(back.zones.team).toEqual(expect.arrayContaining([{ id: leia.id, qty: 2, owned: 0 }]));
    expect(back.zones.battlefield).toEqual([{ id: battlefield.id, qty: 1, owned: 0 }]);
    expect(back.zones.main?.reduce((s, e) => s + e.qty, 0)).toBe(30);
  });

  it('buys official cards by TCGplayer product id and labels print & play ones', () => {
    const official = card('Official', 'event', 'neutral', 'gray', { tcg: 4242 });
    const pnp = card('Community', 'event', 'neutral', 'gray', { pnp: true, price: null });
    const idx = indexCards({ updated: '', cards: [official, pnp] });
    const d = newDeck(arh, 't');
    setQty(d, 'main', official.id, 2);
    setQty(d, 'main', pnp.id, 2);
    const m = massEntry(game, d, idx);
    expect(m.lines).toEqual(['2-4242']);
    expect(m.unlisted).toEqual(['Community']);
    expect(game.priceNote!(pnp)).toBe('Print & play');
  });
});
