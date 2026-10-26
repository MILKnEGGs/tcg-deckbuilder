// The Considering list travels with exported lists too, as a "Considering:" section after the cards (and
// before the description), or a "considering" field in JSON lists. Our import reads it back into Considering;
// pasting elsewhere, delete that section. TCGplayer Mass Entry never includes it.

import { asObject } from './description';
import { listNamer, parseTextDeck } from './import';
import type { Card, CardIndex, Deck, Entry, FormatDef, GameDef } from './types';

const HEADING = /^\s*considering\s*:?\s*$/i;

/** The exported list with the Considering section added, if the deck has any. */
export function addConsidering<C extends Card>(text: string, deck: Deck, game: GameDef<C>, cards: CardIndex<C>): string {
  const list = (deck.considering ?? []).filter((e) => e.qty > 0);
  if (!list.length) return text;
  const json = asObject(text);
  if (json) {
    json.considering = list.map((e) => ({ id: e.id, count: e.qty }));
    return JSON.stringify(json, null, 2);
  }
  const name = listNamer(cards, (c) => game.label(c));
  const lines = list.map((e) => {
    const c = cards.get(e.id);
    return `${e.qty} ${c ? name(c) : `[${e.id}]`}`;
  });
  return `${text.trimEnd()}\n\nConsidering:\n${lines.join('\n')}`;
}

/** Splits the Considering section off a pasted list (call after takeDescription). */
export function takeConsidering<C extends Card>(
  text: string,
  game: GameDef<C>,
  cards: CardIndex<C>,
  format: FormatDef,
): { text: string; considering?: Entry[]; skipped: string[] } {
  const merge = (list: Entry[]) => {
    const out: Entry[] = [];
    for (const e of list) {
      const id = cards.get(e.id)?.id ?? e.id;
      const x = out.find((o) => o.id === id);
      if (x) x.qty += e.qty;
      else out.push({ id, qty: e.qty, owned: 0 });
    }
    return out.length ? out : undefined;
  };
  const json = asObject(text);
  if (json) {
    const raw = Array.isArray(json.considering) ? (json.considering as { id?: string; count?: number }[]) : [];
    const known = raw.filter((x) => x.id && cards.has(x.id));
    return {
      text,
      considering: merge(known.map((x) => ({ id: x.id!, qty: Number(x.count) || 1, owned: 0 }))),
      skipped: raw.filter((x) => !x.id || !cards.has(x.id)).map((x) => String(x.id)),
    };
  }
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => HEADING.test(l));
  if (at < 0) return { text, skipped: [] };
  const section = lines.slice(at + 1).join('\n');
  let considering: Entry[] | undefined;
  let skipped: string[] = [];
  if (section.trim()) {
    try {
      const parsed = parseTextDeck(game, section, cards, format);
      considering = merge(Object.values(parsed.zones).flat());
      skipped = parsed.skipped;
    } catch {
      skipped = section.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }
  }
  return { text: lines.slice(0, at).join('\n'), considering, skipped };
}
