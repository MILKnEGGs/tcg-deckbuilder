import { describe, expect, it } from 'vitest';
import { addCard, indexCards, newDeck, setQty } from '@milk/core/deck';
import { affinityOf, formats, game, illegal, maxCopies, restrictionFit, SEASONS, type AcCard } from './game';

let n = 0;
const card = (name: string, type: string, extra: Partial<AcCard> = {}): AcCard => ({
  id: `T-${++n}`,
  name,
  type,
  colors: ['Black'],
  cost: type === 'Contender' ? null : 2,
  gems: 'B',
  attack: 1,
  defense: 1,
  affiliations: [],
  keywords: [],
  rarity: 'C',
  set: 'AC1',
  sets: ['AC1'],
  img: 1,
  price: 1,
  ...extra,
});

const cons = formats.find((f) => f.id === 'constructed')!;
const casual = formats.find((f) => f.id === 'casual')!;
const moxie = card('Moxie, Ready to Hunt', 'Contender', { character: 'Moxie', affiliations: ['Alpha Hunter'], planet: 'Earth' });
const fillers = Array.from({ length: 13 }, (_, i) => card(`Filler ${i}`, 'Clash'));
const forMoxie = card('Hunter Trap', 'Accessory', { restriction: ['Alpha Hunter'] });
const forKhagan = card('Fangyin, Warden of the Inferno', 'Clash', { restriction: ['Destroyer', 'Khagan'] });
const forSentinel = card('Resiliency', 'Accessory', { restriction: ['Sentinel'] });
const un1 = card('War, the Second Horseman', 'Clash', { keywords: ['Unrivaled'] });
const un2 = card('Dragon Helm', 'Accessory', { keywords: ['Unrivaled'] });
const riv = card('Alpha Empowerment', 'Action', { keywords: ['Rivaled'] });
const riv2 = card('Ultimate Power Armor', 'Accessory', { keywords: ['Rivaled'] });
const buff = card('Power Boost', 'Action', { subtypes: ['Clash Buff'] });
const buff2 = card('Quick Boost', 'Action', { subtypes: ['Clash Buff'] });
const banned = card('Morale Boost', 'Action');
const morac = card('Morac, the Devourer', 'Clash');
const denver = card('Denver', 'Clashground');
const krung = card('Lord Krung, Ruthless Warlord', 'Clash');
const all = [moxie, ...fillers, forMoxie, forKhagan, forSentinel, un1, un2, riv, riv2, buff, buff2, banned, morac, denver, krung];
const cards = indexCards({ updated: '', cards: all });
const messages = (d: ReturnType<typeof newDeck>, f = cons) => game.validate(d, cards, f).map((i) => `${i.level}: ${i.message}`);

function moxieDeck() {
  const d = newDeck(cons, 'test');
  setQty(d, 'contender', moxie.id, 1);
  for (const c of fillers.slice(0, 12)) setQty(d, 'main', c.id, 4);
  setQty(d, 'main', fillers[12].id, 2);
  return d; // 50 cards
}

describe('Alpha Clash deck rules', () => {
  it('accepts one Contender and 50–60 cards', () => {
    const d = moxieDeck();
    expect(messages(d)).toEqual([]);
    setQty(d, 'main', fillers[12].id, 4);
    setQty(d, 'main', forMoxie.id, 4);
    setQty(d, 'main', buff.id, 4);
    expect(messages(d)).toEqual([]); // 60
    setQty(d, 'main', buff2.id, 1);
    expect(messages(d)).toContain('error: 61 cards: the Main Deck holds 50–60. Cut 1');
    expect(messages(newDeck(cons, 't'))).toEqual(expect.arrayContaining(['error: Choose a Contender', 'error: 0/50 cards: add 50 more']));
  });

  it('puts Contenders in their own slot', () => {
    const d = newDeck(cons, 't');
    expect(addCard(game, d, cons, moxie)).toBeNull();
    expect(d.zones.contender).toEqual([{ id: moxie.id, qty: 1, owned: 0 }]);
    expect(addCard(game, d, cons, forMoxie)).toBeNull();
    expect(d.zones.main).toEqual([{ id: forMoxie.id, qty: 1, owned: 0 }]);
  });

  it('caps the sideboard at 15 and counts copies across it', () => {
    const d = moxieDeck();
    setQty(d, 'side', fillers[0].id, 1);
    expect(messages(d)).toContain('error: Filler 0: 5 copies, max 4');
    setQty(d, 'side', fillers[0].id, 0);
    for (const c of [buff, buff2, riv, forMoxie]) setQty(d, 'side', c.id, 4);
    expect(messages(d)).toContain('warning: Sideboard: 16/15. Cut 1');
  });

  it('allows one Unrivaled card, or one Rivaled name, never both', () => {
    const d = moxieDeck();
    setQty(d, 'main', un1.id, 1);
    expect(messages(d)).toEqual([]);
    expect(maxCopies(un1, cons)).toBe(1);
    setQty(d, 'side', un2.id, 1);
    expect(messages(d)[0]).toMatch(/^error: 2 Unrivaled cards/);
    setQty(d, 'side', un2.id, 0);
    setQty(d, 'main', riv.id, 4);
    expect(messages(d)).toContain("error: Unrivaled and Rivaled cards can't share a deck: War, the Second Horseman, Alpha Empowerment");
    setQty(d, 'main', un1.id, 0);
    expect(messages(d)).toEqual([]);
    setQty(d, 'main', riv2.id, 1);
    expect(messages(d)).toContain('error: Rivaled cards with different names: Alpha Empowerment, Ultimate Power Armor. Pick one');
  });

  it('allows at most four Clash Buffs in all', () => {
    const d = moxieDeck();
    setQty(d, 'main', buff.id, 3);
    setQty(d, 'side', buff2.id, 2);
    expect(messages(d)).toContain('error: 5 Clash Buffs: max 4 (Main Deck and Sideboard together)');
  });
});

describe('Alpha Clash deck building restrictions', () => {
  it('lets a card in when the Contender matches any name, affiliation or role it names', () => {
    expect(restrictionFit(forMoxie, moxie, undefined, cons)).toBe('ok');
    expect(restrictionFit(forKhagan, card('Khagan, Dragon Lord', 'Contender', { character: 'Khagan' }), undefined, cons)).toBe('ok');
    expect(restrictionFit(forKhagan, moxie, 'Destroyer', cons)).toBe('ok');
    expect(restrictionFit(forKhagan, moxie, 'Savior', cons)).toBe('no');
    expect(restrictionFit(forKhagan, moxie, undefined, cons)).toBe('role');
  });

  it('warns until the role is set, then errors on a mismatch', () => {
    const d = moxieDeck();
    setQty(d, 'main', forSentinel.id, 2);
    expect(messages(d)).toContain("warning: Set your Contender's role (top of the deck) to check: Resiliency [Sentinel]");
    d.options = { role: 'Destroyer' };
    expect(messages(d)).toContain("error: Moxie, Ready to Hunt (Destroyer) can't include: Resiliency [Sentinel]");
    d.options = { role: 'Sentinel' };
    expect(messages(d)).toEqual([]);
  });

  it('counts both sides of a two-sided Contender', () => {
    const shadow = card('Shadowlight, Bright Beacon', 'Contender', {
      colors: ['White', 'Black'],
      back: { name: 'Shadowlight, Dark Absence', colors: ['Black'], attack: 1, defense: 0, img: 2 },
    });
    expect(restrictionFit(card('Annihilation', 'Action', { restriction: ['Black'] }), shadow, undefined, cons)).toBe('ok');
    expect(restrictionFit(card('Light Only', 'Action', { restriction: ['Shadowlight'] }), shadow, undefined, cons)).toBe('ok');
  });

  it('limits non-matching cards to one copy under Affinity', () => {
    const entropy = card('Entropy, the Progenitor of Chaos', 'Contender', { text: 'Affinity: Colorless\n30: something' });
    expect(affinityOf(entropy)).toEqual(['Colorless']);
    const idx = indexCards({ updated: '', cards: [entropy, fillers[0]] });
    const d = newDeck(cons, 't');
    setQty(d, 'contender', entropy.id, 1);
    expect(maxCopies(fillers[0], cons, d, idx)).toBe(1);
    expect(maxCopies(card('Gear', 'Accessory', { colors: ['Colorless'] }), cons, d, idx)).toBe(4);
  });
});

describe('Alpha Clash ban lists', () => {
  it('uses Rulebook 8.0 until Season 1, then the Season 1 list', () => {
    expect(illegal(banned, cons, '2026-11-11')).toBe('banned (Rulebook 8.0)');
    expect(illegal(morac, cons, '2026-11-11')).toBeNull();
    expect(illegal(morac, cons, '2027-01-01')).toBe('banned (Season 1)');
    expect(illegal(card('Incoming Support', 'Action'), cons, '2027-01-01')).toBeNull();
    expect(illegal(banned, casual, '2026-11-11')).toBeNull();
    expect(maxCopies(denver, cons, undefined, undefined, '2027-01-01')).toBe(1);
    expect(maxCopies(denver, cons, undefined, undefined, '2026-12-31')).toBe(4);
    expect(maxCopies(denver, casual, undefined, undefined, '2027-01-01')).toBe(4);
    expect(restrictionFit(krung, moxie, undefined, cons, '2027-01-01')).toBe('no');
    expect(restrictionFit(krung, card('Trugg', 'Contender', { affiliations: ['Discarded'] }), undefined, cons, '2027-01-01')).toBe('ok');
    expect(restrictionFit(krung, moxie, undefined, cons, '2026-12-31')).toBe('ok');
  });
});

// The downloaded card list, if "npm run data" has run (it isn't committed).
const real = Object.values(import.meta.glob('../public/data/cards.json', { eager: true, import: 'default' }))[0] as { cards: AcCard[] } | undefined;
describe.skipIf(!real)('Alpha Clash ban lists against the card data', () => {
  it('names only real cards (a typo would quietly ban nothing)', () => {
    const names = new Set(real!.cards.map((c) => c.name));
    const listed = SEASONS.flatMap((s) => [...s.banned, ...Object.keys(s.limited), ...Object.keys(s.restrict)]);
    expect(listed.filter((n) => !names.has(n))).toEqual([]);
  });
});

describe('Alpha Clash decklists', () => {
  it('round-trips the text export with Contender and Sideboard sections', () => {
    const d = moxieDeck();
    setQty(d, 'side', forMoxie.id, 2);
    const text = game.exportDeck(d, cards);
    expect(text.startsWith('Contender\n1 Moxie, Ready to Hunt\n\nMain Deck\n')).toBe(true);
    const back = game.importDeck(text, cards, formats);
    expect(back.zones.contender).toEqual([{ id: moxie.id, qty: 1, owned: 0 }]);
    expect(back.zones.main?.length).toBe(13);
    expect(back.zones.side).toEqual([{ id: forMoxie.id, qty: 2, owned: 0 }]);
  });

  it('reads card numbers', () => {
    const ch = card('Mean-Streak, Ready to Brawl', 'Contender', { id: 'AC1-008' });
    const trap = card('Hunter Trap', 'Accessory', { id: 'ST-004' });
    const alt = card('Clarity, Deadly Duelist', 'Clash', { id: 'AC5-001', alt: ['CD3-001'] });
    const idx = indexCards({ updated: '', cards: [ch, trap, alt] });
    const back = game.importDeck('1 AC1-008\n3 Hunter Trap (ST-004)\n2 Clarity CD3-001', idx, formats);
    expect(back.zones.contender).toEqual([{ id: ch.id, qty: 1, owned: 0 }]);
    expect(back.zones.main).toEqual([
      { id: trap.id, qty: 3, owned: 0 },
      { id: alt.id, qty: 2, owned: 0 },
    ]);
  });
});
