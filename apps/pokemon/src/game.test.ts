import { describe, expect, it } from 'vitest';
import { addCard, indexCards, massEntry, newDeck, setQty } from '@milk/core/deck';
import { start } from '@milk/core/goldfish';
import { bannedInExpanded, formats, game, illegal, maxCopies, type PkCard } from './game';

let n = 0;
const card = (name: string, extra: Partial<PkCard> = {}): PkCard => ({
  id: `P${++n}`,
  name,
  category: 'Pokemon',
  stage: 'Basic',
  types: ['Fire'],
  set: 'Test Set',
  codes: [`TST ${n}`],
  code: `TST ${n}`,
  standard: true,
  price: 1,
  tcg: 1000 + n,
  ...extra,
});

const standard = formats.find((f) => f.id === 'standard')!;
const expanded = formats.find((f) => f.id === 'expanded')!;
const charmander = card('Charmander');
const charmanderB = card('Charmander');
const charmeleon = card('Charmeleon', { stage: 'Stage1', evolveFrom: 'Charmander' });
const charizard = card('Charizard ex', { stage: 'Stage2', evolveFrom: 'Charmeleon', tags: ['ex'] });
const pidgey = card('Pidgey', { types: ['Colorless'] });
const pidgeot = card('Pidgeot ex', { stage: 'Stage2', evolveFrom: 'Pidgeotto', tags: ['ex'] });
const pidgeotto = card('Pidgeotto', { stage: 'Stage1', evolveFrom: 'Pidgey' });
const candy = card('Rare Candy', { category: 'Trainer', stage: undefined, types: undefined, trainerType: 'Item' });
const iono = card('Iono', { category: 'Trainer', stage: undefined, types: undefined, trainerType: 'Supporter' });
const ace1 = card('Prime Catcher', { category: 'Trainer', stage: undefined, types: undefined, trainerType: 'Item', aceSpec: true });
const ace2 = card('Master Ball', { category: 'Trainer', stage: undefined, types: undefined, trainerType: 'Item', aceSpec: true });
const fire = card('Fire Energy', { category: 'Energy', stage: undefined, types: undefined, basicEnergy: true, codes: [], code: undefined });
const old = card('Old Card', { standard: undefined, mark: 'D' });
const unownBanned = card('Unown', { codes: ['LOT 90', 'LOT 91'] });
const unownFine = card('Unown', { codes: ['LOT 92'] });
const all = [charmander, charmanderB, charmeleon, charizard, pidgey, pidgeot, pidgeotto, candy, iono, ace1, ace2, fire, old, unownBanned, unownFine];
const cards = indexCards({ updated: '', cards: all });

function deckOf(list: [PkCard, number][], format = standard) {
  const d = newDeck(format, 'test');
  for (const [c, q] of list) setQty(d, 'main', c.id, q);
  return d;
}
const messages = (d: ReturnType<typeof deckOf>, f = standard) => game.validate(d, cards, f).map((i) => i.message);

describe('pokemon legality', () => {
  it('uses the Standard flag and the Expanded banned printings', () => {
    expect(illegal(old, standard)).toMatch(/not Standard-legal/);
    expect(illegal(old, expanded)).toBeNull();
    expect(bannedInExpanded(unownBanned)).toBe(true);
    expect(bannedInExpanded(unownFine)).toBe(false);
    expect(illegal(unownBanned, expanded)).toBe('banned in Expanded');
  });
});

describe('pokemon copy limits', () => {
  it('counts 4 per name across printings, with Basic Energy unlimited and ACE SPEC at 1', () => {
    const d = deckOf([[charmander, 3]]);
    expect(maxCopies(charmanderB, standard, d, cards)).toBe(1);
    expect(maxCopies(fire, standard, d, cards)).toBeGreaterThan(4);
    expect(maxCopies(ace1, standard, d, cards)).toBe(1);
    expect(addCard(game, d, standard, charmanderB, 'main', cards)).toBeNull();
    expect(addCard(game, d, standard, charmanderB, 'main', cards)).not.toBeNull();
  });

  it('flags too many of a name, a second ACE SPEC and a deck with no Basic Pokémon', () => {
    expect(messages(deckOf([[charmander, 3], [charmanderB, 2]]))).toContainEqual(expect.stringMatching(/Charmander: 5 copies across 2 cards/));
    expect(messages(deckOf([[charmander, 1], [ace1, 1], [ace2, 1]]))).toContainEqual(expect.stringMatching(/Only 1 ACE SPEC/));
    expect(messages(deckOf([[iono, 4]]))).toContain('Add at least one Basic Pokémon');
  });
});

describe('pokemon evolutions', () => {
  it('warns about a missing stage, letting Rare Candy cover Stage 1', () => {
    expect(messages(deckOf([[charizard, 2], [charmander, 4]]))).toContainEqual(expect.stringMatching(/Charizard ex needs Charmeleon/));
    expect(messages(deckOf([[charizard, 2], [charmander, 4], [candy, 4]])).some((m) => m.startsWith('Evolution'))).toBe(false);
    expect(messages(deckOf([[pidgeot, 2], [candy, 4], [charmander, 4]]))).toContainEqual(expect.stringMatching(/Pidgeot ex needs Pidgey/));
    expect(messages(deckOf([[charizard, 2], [charmeleon, 2], [charmander, 4]])).some((m) => m.startsWith('Evolution'))).toBe(false);
  });
});

describe('pokemon decklists', () => {
  it('round-trips a Pokémon TCG Live list, matching by set code then name', () => {
    const d = deckOf([[charmander, 4], [charizard, 2], [iono, 4], [fire, 10]]);
    const text = game.exportDeck(d, cards);
    expect(text).toContain('Pokémon: 6');
    expect(text).toContain(`4 Charmander ${charmander.code}`);
    expect(text).toContain('Energy: 10');
    expect(text).toContain('10 Basic {R} Energy SVE 2');
    const back = game.importDeck(text, cards, formats);
    expect(back.zones.main).toEqual(d.zones.main);
    expect(back.format).toBe('standard');
  });

  it('reads Basic {R} Energy and unknown codes by name, padded numbers, and skips junk', () => {
    const back = game.importDeck('Pokémon: 1\n4 Charmander XYZ 999\nEnergy: 8\n8 Basic {R} Energy SVE 002\nTotal Cards: 12\nnonsense line', cards, formats);
    expect(back.zones.main.map((e) => [cards.get(e.id)!.name, e.qty])).toEqual([
      ['Charmander', 4],
      ['Fire Energy', 8],
    ]);
    expect(back.skipped).toEqual(['nonsense line']);
  });

  it('builds TCGplayer Mass Entry by product id', () => {
    const { url } = massEntry(game, deckOf([[charmander, 2]]), cards);
    expect(decodeURIComponent(url!)).toContain(`2-${charmander.tcg}`);
  });
});

describe('pokemon goldfish', () => {
  it('always opens with a Basic Pokémon', () => {
    const d = deckOf([[pidgey, 1], [iono, 4], [candy, 4], [fire, 51]]);
    for (let i = 0; i < 20; i++) expect(start(d, game.goldfish!, cards).hand).toContain(pidgey.id);
  });
});
