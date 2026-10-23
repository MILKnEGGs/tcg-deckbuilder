import { describe, expect, it } from 'vitest';
import { atLeastOne, move, mulligan, nextTurn, setupDone, start } from './goldfish';
import type { Deck, GoldfishDef } from './types';

const cfg: GoldfishDef = { hand: 6, mulligans: 1, draw: 2, turn: 'Round', resources: { setup: 2, perTurn: 1 }, zones: ['main'] };
const deck: Deck = {
  id: 'd',
  name: 'd',
  format: 'f',
  created: 0,
  updated: 0,
  zones: { main: Array.from({ length: 20 }, (_, i) => ({ id: `C${i}`, qty: 3, owned: 0 })), leader: [{ id: 'L', qty: 1, owned: 0 }] },
};

describe('goldfish', () => {
  it('deals an opening hand from the deck zones only', () => {
    const f = start(deck, cfg);
    expect(f.hand).toHaveLength(6);
    expect(f.library).toHaveLength(54);
    expect(f.hand).not.toContain('L');
  });

  it('allows one mulligan', () => {
    let f = start(deck, cfg);
    f = mulligan(f, cfg);
    expect(f.mulligansLeft).toBe(0);
    expect(f.hand).toHaveLength(6);
    expect(f.library).toHaveLength(54);
    expect(mulligan(f, cfg)).toBe(f);
  });

  it('needs the setup resources before the first round, then draws and allows resourcing each round', () => {
    let f = start(deck, cfg);
    expect(setupDone(f, cfg)).toBe(false);
    f = move(f, 0, 'resources');
    f = move(f, 0, 'resources');
    expect(move(f, 0, 'resources')).toBe(f); // no third
    expect(setupDone(f, cfg)).toBe(true);
    f = nextTurn(f, cfg);
    expect([f.turn, f.hand.length, f.resourcesLeft]).toEqual([1, 4, 0]);
    f = nextTurn(f, cfg);
    expect([f.turn, f.hand.length, f.resourcesLeft]).toEqual([2, 6, 1]);
  });

  it('deals a stack sized from the deck and grows the counter each turn', () => {
    const op: GoldfishDef = {
      hand: 5,
      mulligans: 1,
      draw: 1,
      turn: 'Turn',
      zones: ['main'],
      stack: { name: 'Life', count: 5, countFrom: (d) => (d.zones.leader?.length ? 4 : 5) },
      counter: { name: 'DON!!', first: 1, perTurn: 2, max: 10 },
    };
    let f = start(deck, op);
    expect(f.stackSize).toBe(4);
    f = nextTurn(f, op);
    expect([f.stack.length, f.counter]).toEqual([4, 1]);
    for (let i = 0; i < 6; i++) f = nextTurn(f, op);
    expect(f.counter).toBe(10);
  });

  it('computes the odds of drawing at least one of a card', () => {
    expect(atLeastOne(50, 0, 6)).toBe(0);
    expect(atLeastOne(50, 50, 6)).toBe(1);
    // 12 two-drops in 50 cards, 6-card hand: 1 - C(38,6)/C(50,6) ≈ 0.826
    expect(atLeastOne(50, 12, 6)).toBeCloseTo(0.826, 3);
  });
});
