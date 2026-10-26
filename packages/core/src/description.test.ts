import { describe, expect, it } from 'vitest';
import { addDescription, takeDescription } from './description';

describe('deck descriptions in exported lists', () => {
  it('adds a Description section to text lists and takes it back out', () => {
    const list = 'Hero: Dorinthea Ironsong\n\nDeck cards\n3x Snatch (red)';
    const out = addDescription(list, 'Swing the sword twice.\n\nBlock with blues.');
    expect(out).toBe(`${list}\n\nDescription:\nSwing the sword twice.\n\nBlock with blues.`);
    expect(takeDescription(out)).toEqual({ text: `${list}\n`, description: 'Swing the sword twice.\n\nBlock with blues.' });
  });

  it('leaves lists alone without a description', () => {
    expect(addDescription('4 Charmander PAF 7', '  ')).toBe('4 Charmander PAF 7');
    expect(takeDescription('4 Charmander PAF 7')).toEqual({ text: '4 Charmander PAF 7' });
  });

  it('reads a description on the heading line', () => {
    expect(takeDescription('1 Card\nDescription: Aggro.').description).toBe('Aggro.');
  });

  it('puts it in JSON metadata, so SWUDB-style lists stay valid JSON', () => {
    const json = JSON.stringify({ metadata: { name: 'Vader', author: '' }, deck: [] });
    const out = addDescription(json, 'Push damage early.');
    expect(JSON.parse(out).metadata.description).toBe('Push damage early.');
    expect(takeDescription(out).description).toBe('Push damage early.');
    expect(JSON.parse(addDescription('{"deck":[]}', 'x')).description).toBe('x');
  });
});
