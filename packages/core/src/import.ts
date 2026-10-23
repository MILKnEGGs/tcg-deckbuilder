// Plain-text decklists ("3 Card Name" per line), which most sites and people can produce.

import type { Card, CardIndex, Entry, FormatDef, GameDef, Imported } from './types';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Lines look like "3 Name", "3x Name" or just "Name". A card matches on its full label or, failing
 * that, its name when only one card has it. A heading containing "sideboard" sends later lines there.
 */
export function parseTextDeck<C extends Card>(game: GameDef<C>, text: string, cards: CardIndex<C>, format: FormatDef): Imported {
  const byLabel = new Map<string, C>();
  const byName = new Map<string, C | null>();
  for (const c of new Set(cards.values())) {
    byLabel.set(norm(game.label(c)), c);
    const n = norm(c.name);
    byName.set(n, byName.has(n) ? null : c); // null = ambiguous
  }
  const sideZone = format.zones.some((z) => z.id === 'side');
  const zones: Record<string, Entry[]> = {};
  const skipped: string[] = [];
  let side = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
    if (!m && /^[^0-9].*:?$/.test(line) && !byLabel.has(norm(line)) && !byName.get(norm(line))) {
      side = /sideboard/i.test(line); // a heading
      continue;
    }
    const qty = m ? Number(m[1]) : 1;
    // Some lists add the set and number in brackets or parentheses; ignore them.
    const name = norm((m ? m[2] : line).replace(/\s*[[(][^\])]*[\])]\s*$/, ''));
    const card = byLabel.get(name) ?? byLabel.get(name.replace(/ - /, ', ')) ?? byName.get(name) ?? null;
    if (!card) {
      skipped.push(raw.trim());
      continue;
    }
    const home = game.zoneFor(card, format) ?? 'main';
    const zone = side && sideZone && home === 'main' ? 'side' : home;
    const list = (zones[zone] ??= []);
    const e = list.find((x) => x.id === card.id);
    if (e) e.qty += qty;
    else list.push({ id: card.id, qty, owned: 0 });
  }
  if (!Object.keys(zones).length) throw new Error('No cards recognised in that list');
  return { zones, skipped };
}
