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
 * A card id in square brackets ("2 A-Wing [24064]", before any "// comment") names that exact card. Our own
 * exports add it where a name alone could mean several cards, so lists shared between copies of the app
 * come back exactly.
 */
const ID_TAG = /\[([^\]\s]+)\]\s*(?:\/\/.*)?$/;
export function taggedCard<C extends Card>(line: string, cards: CardIndex<C>): C | undefined {
  const m = ID_TAG.exec(line.trim());
  return m ? cards.get(m[1]) : undefined;
}

/** Turns a card into its list text (`key`), adding " [id]" when other cards share that text. */
export function listNamer<C extends Card>(cards: CardIndex<C>, key: (c: C) => string): (c: C) => string {
  const count = new Map<string, number>();
  for (const c of new Set(cards.values())) {
    const k = norm(key(c));
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  // Names with "//" (two-sided cards) get the id too: import reads "//" as the start of a comment.
  return (c) => ((count.get(norm(key(c))) ?? 0) > 1 || key(c).includes('//') ? `${key(c)} [${c.id}]` : key(c));
}

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
    // "3 Name" or "3x Name"; a separate "3 x Name" only when the name isn't a card ("X Antibody" is).
    const m = /^(\d+)x?\s+(.+)$/i.exec(line);
    if (!m && /^[^0-9].*:?$/.test(line) && !byLabel.has(norm(line)) && !byName.get(norm(line))) {
      side = /sideboard/i.test(line); // a heading
      continue;
    }
    const qty = m ? Number(m[1]) : 1;
    // Some lists add the set and number in brackets or parentheses; ignore them, unless they're part of the
    // name ("A Titan (Small)").
    const find = (text: string) => {
      const full = norm(text);
      const name = norm(full.replace(/\s*[[(][^\])]*[\])]\s*$/, ''));
      return byLabel.get(full) ?? byName.get(full) ?? byLabel.get(name) ?? byLabel.get(name.replace(/ - /, ', ')) ?? byName.get(name) ?? null;
    };
    const rest = m ? m[2] : line;
    const card = taggedCard(raw, cards) ?? find(rest) ?? (/^x\s+/i.test(rest) ? find(rest.replace(/^x\s+/i, '')) : null);
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
