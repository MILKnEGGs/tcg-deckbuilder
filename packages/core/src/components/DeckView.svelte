<script lang="ts" generics="C extends Card">
  // The Deck view: the deck alone, for reviewing and refining. Leaders/bases up top, then each group
  // as a column of overlapping cards (hover or tap to see one), Considering in yellow, then stats.
  import type { Card, CardIndex, Deck, Entry, FormatDef, GameDef, Issue } from '../types';
  import { plural } from '../util';
  import CostCurve from './CostCurve.svelte';
  import DeckActions from './DeckActions.svelte';
  import DeckPanel from './DeckPanel.svelte';
  import DeckSummary from './DeckSummary.svelte';

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
    onConsider,
    onPromote,
    onDemote,
    onGoldfish,
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
    onConsider: (c: C, n?: number) => void;
    onPromote: (c: C) => void;
    onDemote: (c: C, zone: string) => void;
    onGoldfish?: () => void;
  } = $props();

  const LAYOUT_KEY = 'deckview-layout';
  let layout = $state<'images' | 'list'>(readLayout());
  function readLayout(): 'images' | 'list' {
    try {
      return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'images';
    } catch {
      return 'images';
    }
  }
  function setLayout(v: 'images' | 'list') {
    layout = v;
    try {
      localStorage.setItem(LAYOUT_KEY, v);
    } catch {
      /* private mode: just don't remember */
    }
  }

  const flagged = $derived(new Map(issues.flatMap((i) => (i.cards ?? []).map((id) => [id, i.level] as const))));
  const commandCards = $derived(
    format.zones
      .filter((z) => z.command)
      .flatMap((z) => (deck.zones[z.id] ?? []).flatMap((e) => Array.from({ length: e.qty }, () => index.get(e.id))))
      .filter((c): c is C => !!c),
  );
  const missingCommand = $derived(format.zones.filter((z) => z.command && (deck.zones[z.id] ?? []).reduce((n, e) => n + e.qty, 0) < z.max));

  type Row = { e: Entry; c: C };
  type Column = { key: string; title: string; rows: Row[]; kind: 'deck' | 'side' | 'maybe' };
  const byCost = (a: Row, b: Row) => (game.cost(a.c) ?? 0) - (game.cost(b.c) ?? 0) || game.label(a.c).localeCompare(game.label(b.c));
  const rowsOf = (list: Entry[]) => list.map((e) => ({ e, c: index.get(e.id) })).filter((r): r is Row => !!r.c);

  const columns = $derived.by(() => {
    const cols: Column[] = [];
    const groups = new Map<string, Row[]>();
    for (const r of rowsOf(deck.zones.main ?? [])) {
      const g = game.group(r.c);
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
    }
    const order = (g: string) => game.groups.indexOf(g) + 1 || 99;
    for (const [g, rows] of [...groups].sort(([a], [b]) => order(a) - order(b))) cols.push({ key: g, title: g, rows: rows.sort(byCost), kind: 'deck' });
    for (const z of format.zones.filter((z) => !z.command && z.id !== 'main')) {
      const rows = rowsOf(deck.zones[z.id] ?? []);
      if (rows.length) cols.push({ key: z.id, title: z.name, rows: rows.sort(byCost), kind: 'side' });
    }
    const maybe = rowsOf(deck.considering ?? []);
    if (maybe.length) cols.push({ key: 'considering', title: 'Considering', rows: maybe.sort(byCost), kind: 'maybe' });
    return cols;
  });

  // Breakdown of the main deck by the game's chosen filters (aspects, arenas, …).
  const breakdown = $derived(
    (game.stats ?? [])
      .map((id) => game.filters.find((f) => f.id === id))
      .filter((f) => !!f)
      .map((f) => {
        const counts = new Map<string | number, number>();
        for (const e of deck.zones.main ?? []) {
          const c = index.get(e.id);
          if (c) for (const v of new Set(f.values(c))) counts.set(v, (counts.get(v) ?? 0) + e.qty);
        }
        const order = (v: string | number) => (f.options ?? []).indexOf(v) + 1 || 99;
        return { label: f.label, items: [...counts].sort(([a], [b]) => order(a) - order(b)) };
      })
      .filter((b) => b.items.length),
  );
</script>

<div class="toolbar">
  <div class="seg" role="group" aria-label="Layout">
    <button class:on={layout === 'images'} onclick={() => setLayout('images')}>Images</button>
    <button class:on={layout === 'list'} onclick={() => setLayout('list')}>List</button>
  </div>
  {#if onGoldfish}
    <button class="goldfish" onclick={onGoldfish}>🐟 Goldfish</button>
  {/if}
</div>

{#if layout === 'list'}
  <div class="listwrap">
    <DeckPanel {game} {index} {deck} {format} {issues} {changed} {say} {onAdd} {onRemove} {onOpen} {onPick} {onConsider} {onPromote} {onDemote} />
  </div>
{:else}
  <div class="wrap">
    <div class="top">
      <div class="summary"><DeckSummary {index} {deck} {format} {issues} sticky={false} /></div>
      <div class="command">
        {#each commandCards as c, i (c.id + i)}
          <button class="lead" class:flag-error={flagged.get(c.id) === 'error'} onclick={() => onOpen(c)} title={game.label(c)}>
            <img src={game.image(c).src} alt={game.label(c)} />
          </button>
        {/each}
        {#each missingCommand as z (z.id)}
          <button class="lead empty" onclick={() => onPick(z.id)}>+ {z.name.replace(/s$/, '')}</button>
        {/each}
      </div>
    </div>

    {#if !columns.length}
      <p class="empty-deck muted">No cards yet. Switch to <strong>Build</strong> to add some.</p>
    {/if}

    <div class="columns">
      {#each columns as col (col.key)}
        <section class="col" class:maybe={col.kind === 'maybe'} class:side={col.kind === 'side'}>
          <h3>{col.title} <span class="num">{col.rows.reduce((n, r) => n + r.e.qty, 0)}</span></h3>
          <div class="stack">
            {#each col.rows as { e, c } (e.id)}
              {@const miss = col.kind === 'maybe' && game.fit ? game.fit.miss(c, deck, index) : null}
              <button
                class="card"
                class:flag-error={flagged.get(c.id) === 'error'}
                class:flag-warning={flagged.get(c.id) === 'warning'}
                onclick={() => onOpen(c)}
                title="{e.qty} × {game.label(c)}{miss ? ` (${miss})` : ''}"
              >
                <img src={game.image(c).src} alt={game.label(c)} loading="lazy" decoding="async" />
                <span class="qty num">{e.qty}×</span>
                {#if e.owned >= e.qty}<span class="own" title="Owned">✓</span>{:else if e.owned}<span class="own some" title="Owned {e.owned} of {e.qty}">{e.owned}/{e.qty}</span>{/if}
                {#if miss}<span class="miss">{miss}</span>{/if}
              </button>
            {/each}
          </div>
          {#if col.kind === 'maybe'}
            <p class="hint small">Tap a card to move it into the deck.</p>
          {/if}
        </section>
      {/each}
    </div>

    <div class="stats">
      <section>
        <h3>Cost curve</h3>
        <CostCurve {game} {index} {deck} />
      </section>
      {#each breakdown as b (b.label)}
        <section>
          <h3>{b.label}</h3>
          <ul class="counts">
            {#each b.items as [v, n] (v)}
              <li><span>{v}</span><span class="num">{n}</span></li>
            {/each}
          </ul>
        </section>
      {/each}
      <section class="actions">
        <DeckActions {game} {index} {deck} {format} {changed} {say} />
      </section>
    </div>
    <p class="foot muted small">{plural(columns.reduce((n, c) => n + c.rows.length, 0), 'different card')} · tap any card for details, +/−, and Considering.</p>
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px 0;
    max-width: 1400px;
    margin: 0 auto;
  }
  .seg {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .seg button {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
  }
  .seg button.on {
    background: var(--panel-2);
    color: var(--text);
    font-weight: 600;
  }
  .listwrap {
    max-width: 760px;
    margin: 10px auto 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
  }
  .wrap {
    max-width: 1400px;
    margin: 0 auto;
    padding: 10px 16px 32px;
  }
  .top {
    display: grid;
    grid-template-columns: minmax(280px, 380px) 1fr;
    gap: 16px;
    align-items: start;
  }
  .summary {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    padding-bottom: 10px;
  }
  .command {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .lead {
    /* Up to three across (two leaders and a base), never wider than 260px. */
    width: min(260px, calc((100% - 24px) / 3));
    aspect-ratio: 88 / 63;
    padding: 0;
    border: 0;
    border-radius: 12px;
    overflow: hidden;
    background: var(--panel-2);
  }
  .lead img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .lead.flag-error {
    outline: 3px solid var(--error);
  }
  .lead.empty {
    border: 1px dashed var(--line);
    color: var(--muted);
  }
  .empty-deck {
    padding: 30px 0;
    text-align: center;
  }
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 18px 14px;
    margin-top: 20px;
    align-items: start;
  }
  .col h3 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin: 0 0 8px;
  }
  .col.maybe h3 {
    color: var(--maybe);
  }
  .col.maybe .stack {
    padding: 6px;
    border-radius: 10px;
    background: var(--maybe-bg);
    outline: 1px solid color-mix(in srgb, var(--maybe) 45%, transparent);
  }
  .col.side h3 {
    color: var(--text);
  }
  /* Each card shows only its top strip (the name), except the last; hover or focus lifts one out. */
  .stack {
    display: flex;
    flex-direction: column;
  }
  .card {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 63 / 88;
    padding: 0;
    border: 0;
    border-radius: 9px;
    overflow: hidden;
    background: var(--panel-2);
    box-shadow: 0 -2px 6px rgb(0 0 0 / 0.5);
    transition: transform 0.12s;
  }
  .card + .card {
    margin-top: -112%;
  }
  .card:hover,
  .card:focus-visible {
    z-index: 3;
    transform: translateY(-4px) scale(1.03);
  }
  .card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .card.flag-error {
    outline: 2px solid var(--error);
    outline-offset: -2px;
  }
  .card.flag-warning {
    outline: 2px solid var(--warning);
    outline-offset: -2px;
  }
  .maybe .card {
    outline: 2px solid var(--maybe);
    outline-offset: -2px;
  }
  .qty {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 1px 7px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.78);
    color: #fff;
    font-weight: 700;
    font-size: 0.85rem;
  }
  .maybe .qty {
    background: var(--maybe);
    color: var(--maybe-ink);
  }
  .own {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--ok);
    color: #052e12;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .own.some {
    background: var(--warning);
    color: #2a1d02;
  }
  .miss {
    position: absolute;
    left: 6px;
    right: 6px;
    bottom: 6px;
    padding: 2px 6px;
    border-radius: 6px;
    background: rgb(0 0 0 / 0.8);
    color: var(--warning);
    font-size: 0.75rem;
    text-align: center;
  }
  .hint {
    color: var(--maybe);
    margin: 6px 0 0;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
    margin-top: 28px;
  }
  .stats > section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 4px 14px 12px;
  }
  .stats > section.actions {
    padding: 0;
    grid-column: 1 / -1;
  }
  .stats h3 {
    font-size: 0.95rem;
    margin: 10px 0 8px;
  }
  .counts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 3px;
  }
  .counts li {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
  }
  .foot {
    text-align: center;
    margin-top: 18px;
  }
  @media (max-width: 760px) {
    .top {
      grid-template-columns: 1fr;
    }
    .command {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }
    .lead {
      width: 100%;
    }
    .columns {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px 10px;
    }
  }
</style>
