// Validation building blocks most games share. A game's validate() combines these with its own rules.

import { sizeOf, zoneCount } from './deck';
import type { Card, CardIndex, Deck, FormatDef, GameDef, Issue } from './types';
import { plural } from './util';

/**
 * Deck size against the format's target. Too few is an error; too many is only a warning, because
 * building usually means adding everything you're considering first and cutting afterwards.
 */
export function sizeIssues(deck: Deck, format: FormatDef, what = 'cards'): Issue[] {
  const n = sizeOf(deck, format);
  const { target, exact } = format.size;
  if (n < target) return [{ level: 'error', message: `${n}/${target} ${what}: add ${target - n} more` }];
  if (n > target)
    return [
      {
        level: 'warning',
        message: exact
          ? `Too many cards: ${n}/${target}. Cut ${n - target}`
          : `${n - target} over the ${target}-card minimum. Legal, but most decks cut down to ${target}`,
      },
    ];
  return [];
}

/** A zone that must hold exactly `need` cards (leaders, bases). */
export function exactZone(deck: Deck, zone: string, need: number, noun: string): Issue[] {
  const n = zoneCount(deck, zone);
  if (n < need) return [{ level: 'error', message: need === 1 ? `Choose a ${noun}` : `Choose ${need} ${noun}s (${n}/${need})` }];
  if (n > need) return [{ level: 'error', message: `Too many ${noun}s: ${n}/${need}` }];
  return [];
}

/** A zone with a legal maximum below its hard cap (sideboards). */
export function zoneLimit(deck: Deck, zone: string, limit: number, name: string): Issue[] {
  const n = zoneCount(deck, zone);
  return n > limit ? [{ level: 'warning', message: `${name}: ${n}/${limit}. Cut ${n - limit}` }] : [];
}

/** Copies across all zones above what the game allows (e.g. after switching to a singleton format). */
export function copyIssues<C extends Card>(game: GameDef<C>, deck: Deck, cards: CardIndex<C>, format: FormatDef): Issue[] {
  const counts = new Map<string, number>();
  for (const list of Object.values(deck.zones)) for (const e of list) counts.set(e.id, (counts.get(e.id) ?? 0) + e.qty);
  const issues: Issue[] = [];
  for (const [id, n] of counts) {
    const c = cards.get(id);
    if (!c) continue;
    const max = game.maxCopies(c, format, deck, cards);
    if (n > max) issues.push({ level: 'error', message: `${game.label(c)}: ${n} copies, max ${max}`, cards: [id] });
  }
  return issues;
}

/** Cards whose type isn't allowed in the zone they're in. */
export function misplaced<C extends Card>(game: GameDef<C>, deck: Deck, cards: CardIndex<C>, format: FormatDef): Issue[] {
  const issues: Issue[] = [];
  for (const z of format.zones) {
    const bad = (deck.zones[z.id] ?? []).filter((e) => {
      const c = cards.get(e.id);
      if (!c) return false;
      const home = game.zoneFor(c, format);
      // Cards that go in the main deck may also sit in a sideboard.
      return home !== z.id && !(home === 'main' && z.id === 'side');
    });
    if (bad.length)
      issues.push({
        level: 'error',
        message: `${plural(bad.length, 'card')} can't be in ${z.name}: ${bad.map((e) => game.label(cards.get(e.id)!)).join(', ')}`,
        cards: bad.map((e) => e.id),
      });
  }
  return issues;
}

/** Cards the format doesn't allow at all, grouped by reason ("rotated out", "suspended"). */
export function legalityIssues<C extends Card>(game: GameDef<C>, deck: Deck, cards: CardIndex<C>, format: FormatDef): Issue[] {
  if (!game.illegal) return [];
  const byReason = new Map<string, string[]>();
  for (const list of Object.values(deck.zones))
    for (const e of list) {
      const c = cards.get(e.id);
      const why = c && game.illegal(c, format);
      if (why) (byReason.get(why) ?? byReason.set(why, []).get(why)!).push(e.id);
    }
  return [...byReason].map(([why, ids]) => ({
    level: 'error' as const,
    message: `${why[0].toUpperCase()}${why.slice(1)}: ${ids.map((id) => game.label(cards.get(id)!)).join(', ')}`,
    cards: ids,
  }));
}

/** Saved cards missing from today's data (shouldn't happen, but never lose them silently). */
export function unknownCards<C extends Card>(deck: Deck, cards: CardIndex<C>): Issue[] {
  const ids = Object.values(deck.zones).flatMap((l) => l.filter((e) => !cards.has(e.id)).map((e) => e.id));
  return ids.length ? [{ level: 'warning', message: `Unknown cards (not in the card data): ${ids.join(', ')}`, cards: ids }] : [];
}
