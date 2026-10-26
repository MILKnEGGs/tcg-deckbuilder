// A deck's description ("how to play") travels with every exported list, whatever the game's format:
// text lists get a "Description:" section at the end, JSON lists (SWUDB) a metadata.description field.
// Import takes it back out before the game's own parser sees the list.

const HEADING = /^\s*description\s*:\s*(.*)$/i;

/** The exported list with the description added, if there is one. */
export function addDescription(text: string, description: string | undefined): string {
  const d = description?.trim();
  if (!d) return text;
  const json = asObject(text);
  if (json) {
    if (json.metadata && typeof json.metadata === 'object') (json.metadata as Record<string, unknown>).description = d;
    else json.description = d;
    return JSON.stringify(json, null, 2);
  }
  return `${text.trimEnd()}\n\nDescription:\n${d}`;
}

/** Splits a pasted list into the cards part (for the game's parser) and its description. */
export function takeDescription(text: string): { text: string; description?: string } {
  const json = asObject(text);
  if (json) {
    const meta = json.metadata as Record<string, unknown> | undefined;
    const d = meta?.description ?? json.description;
    return { text, description: typeof d === 'string' && d.trim() ? d.trim() : undefined };
  }
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => HEADING.test(l));
  if (at < 0) return { text };
  const first = HEADING.exec(lines[at])![1];
  const description = [first, ...lines.slice(at + 1)].join('\n').trim();
  return { text: lines.slice(0, at).join('\n'), description: description || undefined };
}

function asObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
