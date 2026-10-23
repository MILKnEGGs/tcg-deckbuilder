<script lang="ts" generics="C extends Card">
  // The deck: size and price, rule issues, command cards (leaders/bases), then the list by group.
  import { cycleOwned, massEntry, setAllOwned, setQty, sizeOf, textList, totals, zoneCount } from '../deck';
  import type { Card, CardIndex, Deck, Entry, FormatDef, GameDef, Issue } from '../types';
  import { money, plural } from '../util';

  let {
    game,
    index,
    deck,
    format,
    issues,
    changed,
    say,
    onAdd,
    onRemove,
    onOpen,
    onPick,
  }: {
    game: GameDef<C>;
    index: CardIndex<C>;
    deck: Deck;
    format: FormatDef;
    issues: Issue[];
    changed: () => void;
    say: (msg: string) => void;
    onAdd: (c: C, zone?: string) => void;
    onRemove: (c: C, zone?: string) => void;
    onOpen: (c: C) => void;
    onPick: (zone: string) => void;
  } = $props();

  const t = $derived(totals(deck, index));
  const size = $derived(sizeOf(deck, format));
  const target = $derived(format.size.target);
  const flagged = $derived(new Map(issues.flatMap((i) => (i.cards ?? []).map((id) => [id, i.level] as const))));
  const commandZones = $derived(format.zones.filter((z) => z.command));
  const listZones = $derived(format.zones.filter((z) => !z.command));

  type Row = { e: Entry; c: C | undefined };
  function grouped(zone: string): [string, Row[]][] {
    const rows: Row[] = (deck.zones[zone] ?? []).map((e) => ({ e, c: index.get(e.id) }));
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const g = r.c ? game.group(r.c) : 'Unknown';
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
    }
    const order = (g: string) => (game.groups.indexOf(g) + 1 || 99);
    return [...groups.entries()]
      .sort(([a], [b]) => order(a) - order(b))
      .map(([g, list]) => [
        g,
        list.sort((a, b) => (a.c && b.c ? (game.cost(a.c) ?? 0) - (game.cost(b.c) ?? 0) || game.label(a.c).localeCompare(game.label(b.c)) : 0)),
      ]);
  }

  // Cost curve of the main deck.
  const curve = $derived.by(() => {
    const counts = new Map<number, number>();
    for (const e of deck.zones.main ?? []) {
      const c = index.get(e.id);
      const cost = c ? game.cost(c) : null;
      if (cost == null) continue;
      const k = Math.min(cost, 8);
      counts.set(k, (counts.get(k) ?? 0) + e.qty);
    }
    const max = Math.max(1, ...counts.values());
    return Array.from({ length: 9 }, (_, i) => ({ label: i === 8 ? '8+' : String(i), n: counts.get(i) ?? 0, h: (counts.get(i) ?? 0) / max }));
  });

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      say(`${what} copied`);
    } catch {
      prompt(`Copy the ${what.toLowerCase()}:`, text);
    }
  }

  async function buy() {
    const list = massEntry(game, deck, index);
    if (!list) return say("You own everything in this deck");
    await copy(list, 'Shopping list');
    window.open('https://www.tcgplayer.com/massentry', '_blank', 'noopener');
  }

  function owned(zone: string, e: Entry) {
    cycleOwned(deck, zone, e.id);
    changed();
  }
  function allOwned(v: boolean) {
    setAllOwned(deck, v);
    changed();
  }
  function drop(zone: string, id: string) {
    setQty(deck, zone, id, 0);
    changed();
  }
</script>

<div class="summary">
  <div class="size" class:over={size > target} class:done={size === target || (!format.size.exact && size > target)}>
    <span class="big num">{size}<span class="of">/{target}</span></span>
    <span class="small muted">{format.size.exact ? 'cards' : 'card minimum'}</span>
  </div>
  <div class="money">
    <div><span class="muted small">Deck</span> <strong class="num">{money(t.total)}</strong></div>
    <div><span class="muted small">To finish</span> <strong class="num finish">{money(t.toFinish)}</strong></div>
    {#if t.unpriced}<div class="muted small">{plural(t.unpriced, 'card')} without a price</div>{/if}
  </div>
</div>

{#if issues.length}
  <ul class="issues">
    {#each issues as i (i.message)}
      <li class={i.level}>{i.message}</li>
    {/each}
  </ul>
{:else if size}
  <p class="legal small">Deck is legal for {format.name}.</p>
{/if}

<div class="command">
  {#each commandZones as z (z.id)}
    {@const list = (deck.zones[z.id] ?? []).flatMap((e) => Array.from({ length: e.qty }, () => e.id))}
    {#each list as id, i (id + i)}
      {@const c = index.get(id)}
      <div class="slot" class:flag-error={flagged.get(id) === 'error'}>
        {#if c}
          <button class="slot-art" onclick={() => onOpen(c)} title={game.label(c)}>
            <img src={game.image(c).src} alt={game.label(c)} />
          </button>
          <button class="slot-x" onclick={() => onRemove(c, z.id)} aria-label="Remove {game.label(c)}">✕</button>
        {:else}
          <span class="muted small">{id}</span>
        {/if}
      </div>
    {/each}
    {#each Array.from({ length: Math.max(0, z.max - zoneCount(deck, z.id)) }) as _, i (i)}
      <button class="slot empty" onclick={() => onPick(z.id)}>+ {z.name.replace(/s$/, '')}</button>
    {/each}
  {/each}
</div>

{#each listZones as z (z.id)}
  {@const groups = grouped(z.id)}
  {#if z.id === 'main' || groups.length}
    <section class="zone">
      <h3>{z.name} <span class="muted num">{zoneCount(deck, z.id)}</span></h3>
      {#if !groups.length}
        <p class="muted small">Add cards from the search.</p>
      {/if}
      {#each groups as [g, rows] (g)}
        <h4>{g} <span class="num">{rows.reduce((n, r) => n + r.e.qty, 0)}</span></h4>
        <ul class="rows">
          {#each rows as { e, c } (e.id)}
            <li class:flag-error={flagged.get(e.id) === 'error'} class:flag-warning={flagged.get(e.id) === 'warning'}>
              <span class="qty">
                <button class="step" onclick={() => c ? onRemove(c, z.id) : drop(z.id, e.id)} aria-label="Remove one">−</button>
                <span class="num">{e.qty}</span>
                <button class="step" onclick={() => c && onAdd(c, z.id)} disabled={!c} aria-label="Add one">+</button>
              </span>
              <button class="cname" onclick={() => c && onOpen(c)}>
                {#if c && game.cost(c) != null}<span class="cost num">{game.cost(c)}</span>{/if}
                <span class="label">{c ? game.label(c) : e.id}</span>
              </button>
              <button
                class="owned num"
                class:all={e.owned >= e.qty}
                class:some={e.owned > 0 && e.owned < e.qty}
                onclick={() => owned(z.id, e)}
                title="Tap to mark the copies you own"
              >
                {e.owned >= e.qty ? '✓' : ''}{e.qty > 1 ? `${e.owned}/${e.qty}` : e.owned ? '' : 'Own?'}
              </button>
              <span class="price num small">{money(c?.price != null ? c.price * e.qty : null)}</span>
            </li>
          {/each}
        </ul>
      {/each}
    </section>
  {/if}
{/each}

<section class="zone">
  <h3>Cost curve</h3>
  <div class="curve">
    {#each curve as b (b.label)}
      <div class="bar">
        <span class="n num small">{b.n || ''}</span>
        <span class="fill" style:height="{Math.round(b.h * 64)}px"></span>
        <span class="small muted">{b.label}</span>
      </div>
    {/each}
  </div>
</section>

<section class="zone actions">
  <h3>Buy & share</h3>
  <button class="primary" onclick={buy}>Buy missing cards on TCGplayer</button>
  <p class="muted small">Copies the cards you don't own and opens TCGplayer Mass Entry. Paste the list there.</p>
  <div class="row">
    <button onclick={() => allOwned(true)}>Mark all owned</button>
    <button onclick={() => allOwned(false)}>Mark none owned</button>
  </div>
  <div class="row">
    <button onclick={() => copy(game.exportDeck(deck, index), 'Decklist')}>{game.exportLabel}</button>
    <button onclick={() => copy(textList(game, deck, index, format), 'Text list')}>Copy text list</button>
  </div>
</section>

<style>
  .summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 0;
    z-index: 4;
    background: var(--panel);
  }
  .size {
    display: grid;
  }
  .big {
    font-size: 1.8rem;
    font-weight: 700;
    line-height: 1;
  }
  .of {
    font-size: 1rem;
    color: var(--muted);
    font-weight: 500;
  }
  .size.done .big {
    color: var(--ok);
  }
  .size.over .big {
    color: var(--warning);
  }
  .money {
    text-align: right;
    display: grid;
    gap: 2px;
  }
  .finish {
    color: var(--accent);
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 10px 16px 0;
    display: grid;
    gap: 6px;
  }
  .issues li {
    padding: 7px 10px;
    border-radius: 8px;
    font-size: 0.88rem;
    border-left: 3px solid;
  }
  .issues .error {
    background: var(--error-bg);
    border-color: var(--error);
  }
  .issues .warning {
    background: var(--warning-bg);
    border-color: var(--warning);
  }
  .legal {
    color: var(--ok);
    margin: 10px 16px 0;
  }
  .command {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
    gap: 8px;
    padding: 12px 16px 4px;
  }
  .slot {
    position: relative;
    aspect-ratio: 88 / 63;
    border-radius: 8px;
    overflow: hidden;
    background: var(--panel-2);
    display: grid;
    place-items: center;
  }
  .slot.flag-error {
    outline: 2px solid var(--error);
  }
  .slot-art {
    padding: 0;
    border: 0;
    width: 100%;
    height: 100%;
  }
  .slot-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .slot-x {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.7);
    font-size: 0.75rem;
  }
  .slot.empty {
    border: 1px dashed var(--line);
    color: var(--muted);
    font-size: 0.9rem;
  }
  .slot.empty:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .zone {
    padding: 8px 16px 12px;
  }
  h3 {
    font-size: 0.95rem;
    margin: 8px 0 6px;
  }
  h4 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin: 12px 0 4px;
    font-weight: 600;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border-radius: 6px;
    border-left: 3px solid transparent;
  }
  .rows li:hover {
    background: var(--panel-2);
  }
  .rows li.flag-error {
    border-left-color: var(--error);
  }
  .rows li.flag-warning {
    border-left-color: var(--warning);
  }
  .qty {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .qty .num {
    min-width: 18px;
    text-align: center;
    font-weight: 600;
  }
  .step {
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border-color: transparent;
    color: var(--muted);
  }
  .step:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--line);
  }
  .cname {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 6px;
    align-items: center;
    background: none;
    border: 0;
    padding: 4px 0;
    text-align: left;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cost {
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--panel-2);
    border: 1px solid var(--line);
    display: grid;
    place-items: center;
    font-size: 0.75rem;
  }
  .owned {
    flex: none;
    min-width: 46px;
    padding: 3px 6px;
    font-size: 0.75rem;
    border-radius: 999px;
    color: var(--muted);
    background: transparent;
  }
  .owned.some {
    color: var(--warning);
    border-color: var(--warning);
  }
  .owned.all {
    color: var(--ok);
    border-color: var(--ok);
  }
  .price {
    flex: none;
    width: 62px;
    text-align: right;
    color: var(--muted);
  }
  .curve {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 100px;
  }
  .bar {
    flex: 1;
    display: grid;
    justify-items: center;
    align-content: end;
    gap: 2px;
  }
  .fill {
    width: 100%;
    background: var(--accent);
    border-radius: 4px 4px 0 0;
    min-height: 1px;
    opacity: 0.85;
  }
  .actions {
    display: grid;
    gap: 8px;
    padding-bottom: 32px;
  }
  .actions p {
    margin: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .row button {
    flex: 1;
  }
  @media (max-width: 860px) {
    .summary {
      top: 41px;
    }
  }
</style>
