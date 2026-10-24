import { describe, expect, it } from 'vitest';
import { addCard, indexCards, massEntry, newDeck, setQty } from '@milk/core/deck';
import { fitReason, formats, game, illegal, maxCopies, primaryOf, symbolFits, type UvsCard } from './game';

let n = 0;
const card = (name: string, type: string, symbols: string[], extra: Partial<UvsCard> = {}): UvsCard => ({
  id: `T-${++n}`,
  name,
  type,
  ip: 'Attack on Titan',
  symbols,
  difficulty: type === 'Character' ? null : 3,
  check: type === 'Character' ? null : 5,
  speed: null,
  handSize: type === 'Character' ? 7 : null,
  health: type === 'Character' ? 25 : null,
  rarity: 'Common',
  set: 'Test',
  standard: true,
  img: 1,
  price: 1,
  ...extra,
});

const std = formats.find((f) => f.id === 'standard')!;
const retro = formats.find((f) => f.id === 'retro')!;
const eren = card('Eren Jaeger', 'Character', ['Death', 'Fire', 'Order']);
const infChar = card('Infinite Hero', 'Character', ['Infinity']);
const deathFoundations = Array.from({ length: 15 }, (_, i) => card(`Death Foundation ${i}`, 'Foundation', ['Death', 'Good']));
const fireOnly = card('Fire Strike', 'Attack', ['Fire', 'Chaos']);
const attunedFire = card('Spring into Action', 'Action', ['Fire'], { attuned: ['Fire'] });
const attunedWater = card('Water Rush', 'Attack', ['Water'], { attuned: ['Water'] });
const twoAttuned = card('Twin Attuned', 'Attack', ['Air', 'Order'], { attuned: ['Air', 'Order'] });
const infinityCard = card('Anywhere Card', 'Asset', ['Infinity']);
const unknown = card('Mystery Promo', 'Foundation', []);
const old = card('Old Card', 'Attack', ['Death'], { standard: undefined });
const banned = card('Risky Encounter', 'Action', ['Death']);
const all = [eren, infChar, ...deathFoundations, fireOnly, attunedFire, attunedWater, twoAttuned, infinityCard, unknown, old, banned];
const cards = indexCards({ updated: '', cards: all });
const messages = (d: ReturnType<typeof newDeck>, f = std) => game.validate(d, cards, f).map((i) => `${i.level}: ${i.message}`);

function erenDeck() {
  const d = newDeck(std, 'test');
  setQty(d, 'character', eren.id, 1);
  for (const c of deathFoundations) setQty(d, 'main', c.id, 4);
  return d;
}

describe('UniVersus symbols', () => {
  it('lets a card in by the primary symbol, an attuned symbol the character has, or infinity', () => {
    expect(fitReason(deathFoundations[0], 'Death', eren)).toBe('primary');
    expect(fitReason(attunedFire, 'Death', eren)).toBe('attuned Fire');
    expect(fitReason(attunedWater, 'Death', eren)).toBeNull(); // Eren has no Water
    expect(fitReason(fireOnly, 'Death', eren)).toBeNull(); // Fire, but not attuned
    expect(fitReason(twoAttuned, 'Death', eren)).toBe('attuned Order'); // needs only one of them
    expect(fitReason(infinityCard, 'Death', eren)).toBe('infinity');
  });

  it('gives an Infinity character only its chosen primary symbol', () => {
    expect(fitReason(deathFoundations[0], 'Death', infChar)).toBe('primary');
    expect(fitReason(attunedFire, 'Death', infChar)).toBeNull();
    expect(fitReason(attunedFire, 'Fire', infChar)).toBe('primary');
  });

  it('picks the primary symbol that fits the most cards, unless one is chosen', () => {
    const d = erenDeck();
    expect(symbolFits(d, cards)).toEqual([
      { symbol: 'Death', fit: 60 },
      { symbol: 'Fire', fit: 0 },
      { symbol: 'Order', fit: 0 },
    ]);
    expect(primaryOf(d, cards)).toBe('Death');
    d.options = { primary: 'Fire' };
    expect(primaryOf(d, cards)).toBe('Fire');
    expect(messages(d)[0]).toMatch(/^error: Missing the Fire symbol/);
  });

  it('accepts a legal 60-card deck and names the cards that miss the symbol', () => {
    const d = erenDeck();
    setQty(d, 'main', attunedFire.id, 2);
    setQty(d, 'main', infinityCard.id, 1);
    setQty(d, 'main', deathFoundations[0].id, 1); // back to 60
    expect(messages(d)).toEqual([]);
    setQty(d, 'main', fireOnly.id, 1);
    setQty(d, 'main', attunedWater.id, 1);
    expect(messages(d)).toContain('error: Missing the Death symbol (and no attuned symbol Eren Jaeger has): Fire Strike, Water Rush');
  });

  it('warns about cards whose symbols are unknown instead of failing them', () => {
    const d = erenDeck();
    setQty(d, 'main', unknown.id, 1);
    expect(messages(d)).toContain('warning: Symbols unknown (check the card): Mystery Promo');
  });
});

describe('UniVersus deck rules', () => {
  it('needs a starting character and 60 cards, and wants a sideboard of exactly 10', () => {
    const d = newDeck(std, 'test');
    expect(messages(d)).toContain('error: Choose a starting character');
    const full = erenDeck();
    setQty(full, 'side', deathFoundations[0].id, 0);
    setQty(full, 'side', attunedFire.id, 3);
    expect(messages(full)).toContain('warning: Sideboard: 3/10. Tournament sideboards are exactly 10 (or none)');
  });

  it('counts copies across the deck and sideboard', () => {
    const d = erenDeck();
    setQty(d, 'side', deathFoundations[0].id, 1);
    expect(messages(d)).toContain('error: Death Foundation 0: 5 copies, max 4');
  });

  it('honours printed copy limits and characters that allow more', () => {
    const legion = card('Mechazoid', 'Attack', ['Death'], { text: 'Your deck may include up to 8 copies of this card.' });
    const yeager = card('Yeagerist Follower', 'Foundation', ['Death'], { text: 'You can include up to 10 copies of this card in your deck.' });
    expect(maxCopies(yeager, std)).toBe(10);
    expect(maxCopies(legion, std)).toBe(8);
    const may = card('MAY', 'Character', ['Fire'], { text: 'Your deck may include up to 8 copies of 1 Ally attack card.' });
    const ally = card('Ally Strike', 'Attack', ['Fire'], { keywords: ['Ally'] });
    const ally2 = card('Ally Kick', 'Attack', ['Fire'], { keywords: ['Ally'] });
    const idx = indexCards({ updated: '', cards: [may, ally, ally2] });
    const d = newDeck(std, 't');
    setQty(d, 'character', may.id, 1);
    expect(maxCopies(ally, std, d, idx)).toBe(8);
    setQty(d, 'main', ally.id, 6);
    expect(maxCopies(ally2, std, d, idx)).toBe(4); // only one card gets the bonus
  });

  it('lets Deku-style characters include a keyword type regardless of symbol', () => {
    const deku = card('Izuku Midoriya, Deku', 'Character', ['Good'], { text: 'Your deck may include Vestige foundations regardless of symbol restrictions.' });
    const vestige = card('Old Vestige', 'Foundation', ['Evil'], { keywords: ['Vestige'] });
    expect(fitReason(vestige, 'Good', deku)).toBe('character rule');
    expect(fitReason(card('Plain', 'Foundation', ['Evil']), 'Good', deku)).toBeNull();
  });

  it('applies Standard rotation and the ban lists per format', () => {
    expect(illegal(old, std)).toBe('rotated out of Standard');
    expect(illegal(old, retro)).toBeNull();
    expect(illegal(banned, std)).toBe('banned in Standard');
    expect(illegal(banned, retro)).toBe('banned in Retro');
    expect(addCard(game, newDeck(std, 't'), std, old)).toMatch(/rotated/);
  });

  it('filters to the character’s IP', () => {
    const d = erenDeck();
    const ipToggle = game.toggles!.find((t) => t.id === 'ip')!;
    expect(ipToggle.test(attunedFire, d, cards)).toBe(true);
    expect(ipToggle.test(card('Godzilla Stomp', 'Attack', ['Death'], { ip: 'Godzilla' }), d, cards)).toBe(false);
  });
});

describe('UniVersus decklists', () => {
  it('round-trips the text export with character and sideboard sections', () => {
    const d = erenDeck();
    setQty(d, 'side', attunedFire.id, 2);
    const back = game.importDeck(game.exportDeck(d, cards), cards, formats);
    expect(back.zones.character).toEqual([{ id: eren.id, qty: 1, owned: 0 }]);
    expect(back.zones.main?.length).toBe(15);
    expect(back.zones.side).toEqual([{ id: attunedFire.id, qty: 2, owned: 0 }]);
  });

  it('buys by TCGplayer product id', () => {
    const c = card('Buy Me', 'Attack', ['Death'], { tcg: 123456 });
    const idx = indexCards({ updated: '', cards: [c] });
    const d = newDeck(std, 't');
    setQty(d, 'main', c.id, 3);
    expect(massEntry(game, d, idx).lines).toEqual(['3-123456']);
  });
});
