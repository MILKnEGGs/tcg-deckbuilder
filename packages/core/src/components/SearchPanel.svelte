<script lang="ts" generics="C extends Card">
  // Card search: free text, filter chips from the game, sort, and a grid of cards to add.
  import { consideringCount, copies } from '../deck';
  import type { Card, CardData, CardIndex, Deck, FormatDef, GameDef } from '../types';
  import { money } from '../util';

  let {
    game,
    data,
    index,
    deck,
    format,
    onlyZone = $bindable(),
    target = $bindable(),
    onAdd,
    onRemove,
    onConsider,
    onOpen,
  }: {
    game: GameDef<C>;
    data: CardData<C>;
    index: CardIndex<C>;
    deck: Deck;
    format: FormatDef;
    onlyZone: string | null;
    /** Whether + adds to the deck or to Considering. */
    target: 'deck' | 'considering';
    onAdd: (c: C) => void;
    onRemove: (c: C) => void;
    onConsider: (c: C, n?: number) => void;
    onOpen: (c: C) => void;
  } = $props();

  const PAGE = 90;
  const SORTS = { cost: 'Cost', name: 'Name', priceUp: 'Price ↑', priceDown: 'Price ↓' } as const;

  let q = $state('');
  let sel = $state<Record<string, (string | number)[]>>({});
  let fit = $state(false);
  let sort = $state<keyof typeof SORTS>('cost');
  let limit = $state(PAGE);
  let showFilters = $state(false);
  let showIllegal = $state(false);
  const maybe = $derived(target === 'considering' && !onlyZone);

  // Precomputed once per data load: search text and each filter's values per card.
  const prepared = $derived(
    data.cards.map((c) => ({
      c,
      text: game.searchText(c),
      values: Object.fromEntries(game.filters.map((f) => [f.id, f.values(c)])),
    })),
  );

  // Chip options: the game's order, then anything else the data has.
  const options = $derived(
    Object.fromEntries(
      game.filters.map((f) => {
        const seen = new Set(prepared.flatMap((p) => p.values[f.id]));
        const listed = (f.options ?? []).filter((o) => seen.has(o));
        const rest = [...seen].filter((o) => !listed.includes(o)).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
        return [f.id, [...listed, ...rest]];
      }),
    ),
  );

  const zoneName = $derived(onlyZone ? (format.zones.find((z) => z.id === onlyZone)?.name ?? onlyZone) : '');
  const activeCount = $derived(Object.values(sel).reduce((n, v) => n + v.length, 0) + (fit ? 1 : 0));

  // Cards the format doesn't allow (rotated out, suspended) are hidden unless asked for.
  const illegalIds = $derived(game.illegal ? new Set(data.cards.filter((c) => game.illegal!(c, format)).map((c) => c.id)) : new Set<string>());
  const found = $derived.by(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const active = Object.entries(sel).filter(([, v]) => v.length);
    // Plain browsing shows deck cards only; leaders and bases come up when you search or filter,
    // or pick an empty slot in the deck.
    const command = new Set(format.zones.filter((z) => z.command).map((z) => z.id));
    const browsing = !words.length && !active.length;
    let hidden = 0;
    const out = prepared
      .filter((p) => {
        const zone = game.zoneFor(p.c, format);
        if (onlyZone ? zone !== onlyZone : !zone || (browsing && command.has(zone))) return false;
        for (const w of words) if (!p.text.includes(w)) return false;
        for (const [id, v] of active) if (!p.values[id].some((x) => v.includes(x))) return false;
        if (fit && game.fit && !game.fit.test(p.c, deck, index, format)) return false;
        if (!showIllegal && illegalIds.has(p.c.id)) {
          hidden++;
          return false;
        }
        return true;
      })
      .map((p) => p.c);
    const byName = (a: C, b: C) => game.label(a).localeCompare(game.label(b));
    const price = (c: C, up: boolean) => c.price ?? (up ? Infinity : -Infinity);
    const cmp: Record<keyof typeof SORTS, (a: C, b: C) => number> = {
      cost: (a, b) => (game.cost(a) ?? -1) - (game.cost(b) ?? -1) || byName(a, b),
      name: byName,
      priceUp: (a, b) => price(a, true) - price(b, true) || byName(a, b),
      priceDown: (a, b) => price(b, false) - price(a, false) || byName(a, b),
    };
    return { cards: out.sort(cmp[sort]), hidden };
  });
  const results = $derived(found.cards);

  // New search or filters start back at the first page.
  $effect(() => {
    void [q, sel, fit, sort, onlyZone, showIllegal];
    limit = PAGE;
  });

  function toggle(id: string, v: string | number) {
    const cur = sel[id] ?? [];
    sel = { ...sel, [id]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
  }

  function clearAll() {
    sel = {};
    fit = false;
    q = '';
    onlyZone = null;
  }
</script>

<div class="bar">
  <div class="target" role="group" aria-label="Add cards to">
    <button class:on={target === 'deck'} onclick={() => (target = 'deck')}>Deck</button>
    <button class:on={target === 'considering'} class="maybe" onclick={() => (target = 'considering')}>Considering</button>
  </div>
  <input type="search" placeholder="Search name, text, traits…" bind:value={q} aria-label="Search cards" />
  <select bind:value={sort} aria-label="Sort">
    {#each Object.entries(SORTS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
  </select>
  <button class="toggle" class:on={showFilters} onclick={() => (showFilters = !showFilters)}>
    Filters{activeCount ? ` (${activeCount})` : ''}
  </button>
</div>

<div class="filters" class:open={showFilters}>
  {#each game.filters as f (f.id)}
    <div class="frow">
      <span class="flabel">{f.label}</span>
      <div class="chips">
        {#each options[f.id] as o (o)}
          <button class="chip" class:on={sel[f.id]?.includes(o)} onclick={() => toggle(f.id, o)}>{o}</button>
        {/each}
      </div>
    </div>
  {/each}
  {#if game.fit}
    <label class="fit"><input type="checkbox" bind:checked={fit} /> {game.fit.label}</label>
  {/if}
</div>

<div class="status small muted">
  {#if onlyZone}
    <button class="chip on" onclick={() => (onlyZone = null)}>Choosing: {zoneName} ✕</button>
  {/if}
  <span class="num">{results.length.toLocaleString()} cards</span>
  {#if activeCount || q || onlyZone}<button class="ghost small" onclick={clearAll}>Clear</button>{/if}
  {#if found.hidden || showIllegal}
    <button class="ghost small illegal-toggle" onclick={() => (showIllegal = !showIllegal)}>
      {showIllegal ? `Hide cards not legal in ${format.name}` : `+${found.hidden} not legal in ${format.name}`}
    </button>
  {/if}
</div>
{#if maybe}
  <p class="maybe-note small">Adding to <strong>Considering</strong>. These sit beside the deck until you move them in.</p>
{/if}

<div class="grid">
  {#each results.slice(0, limit) as c (c.id)}
    {@const img = game.image(c)}
    {@const n = copies(deck, c.id)}
    {@const m = consideringCount(deck, c.id)}
    {@const max = game.maxCopies(c, format)}
    {@const bad = illegalIds.has(c.id)}
    <div class="tile" class:wide={img.landscape} class:in={n > 0} class:considered={m > 0 && !n} class:bad>
      <button class="art" onclick={() => onOpen(c)} title={game.label(c)}>
        <img src={img.src} alt={game.label(c)} loading="lazy" decoding="async" />
        {#if m}<span class="badge maybe-badge num">?{m}</span>{/if}
        {#if bad}<span class="badge bad-badge">Not legal</span>{/if}
      </button>
      <div class="controls">
        {#if maybe}
          <button class="step" onclick={() => onConsider(c, -1)} disabled={!m} aria-label="Consider one fewer {game.label(c)}">−</button>
          <span class="count num maybe-count" class:zero={!m}>?{m}</span>
          <button class="step maybe-step" onclick={() => onConsider(c)} aria-label="Consider {game.label(c)}">+</button>
          <span class="small muted num">{n ? `${n} in deck` : ''}</span>
        {:else}
          <button class="step" onclick={() => onRemove(c)} disabled={!n} aria-label="Remove one {game.label(c)}">−</button>
          <span class="count num" class:zero={!n}>{n}{max < 99 ? `/${max}` : ''}</span>
          <button class="step" onclick={() => onAdd(c)} disabled={n >= max || bad} aria-label="Add one {game.label(c)}">+</button>
        {/if}
        <span class="price num small">{money(c.price)}</span>
      </div>
    </div>
  {/each}
</div>

{#if results.length > limit}
  <div class="more">
    <button onclick={() => (limit += PAGE * 2)}>Show more ({(results.length - limit).toLocaleString()} left)</button>
  </div>
{:else if !results.length}
  <p class="none muted">No cards match.</p>
{/if}

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    gap: 8px;
    padding: 12px 16px 8px;
    background: var(--bg);
  }
  .bar input {
    flex: 1;
  }
  .target {
    display: flex;
    flex: none;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .target button {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    padding: 7px 10px;
  }
  .target button.on {
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
  .target button.maybe.on {
    background: var(--maybe);
    color: var(--maybe-ink);
  }
  .maybe-note {
    margin: -4px 16px 10px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--maybe-bg);
    border-left: 3px solid var(--maybe);
  }
  .art {
    position: relative;
  }
  .badge {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .maybe-badge {
    background: var(--maybe);
    color: var(--maybe-ink);
  }
  .bad-badge {
    top: auto;
    bottom: 6px;
    left: 6px;
    right: auto;
    background: var(--error);
    color: #1a0505;
  }
  .considered .art {
    outline-color: var(--maybe);
  }
  .bad .art img {
    opacity: 0.45;
  }
  .maybe-count {
    color: var(--maybe);
  }
  .maybe-step {
    border-color: var(--maybe);
  }
  .illegal-toggle {
    margin-left: auto;
  }
  .toggle.on {
    border-color: var(--accent);
  }
  .filters {
    display: none;
    padding: 4px 16px 8px;
    gap: 6px;
  }
  .filters.open {
    display: grid;
  }
  .frow {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  .flabel {
    width: 56px;
    flex: none;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .fit {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-top: 4px;
    font-size: 0.9rem;
  }
  .fit input {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
  }
  .status {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 2px 16px 8px;
    min-height: 34px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px 10px;
    padding: 0 16px 16px;
    align-items: end;
  }
  .tile.wide {
    grid-column: span 2;
  }
  .art {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: var(--panel);
    border-radius: 8px;
    overflow: hidden;
    aspect-ratio: 63 / 88;
    outline: 2px solid transparent;
  }
  .wide .art {
    aspect-ratio: 88 / 63;
    max-width: 300px;
    margin: 0 auto;
  }
  .in .art {
    outline-color: var(--accent);
  }
  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
  }
  .wide .controls {
    max-width: 300px;
    margin-left: auto;
    margin-right: auto;
  }
  .step {
    width: 32px;
    height: 30px;
    padding: 0;
    font-size: 1.1rem;
  }
  .count {
    min-width: 34px;
    text-align: center;
    font-weight: 600;
  }
  .count.zero {
    color: var(--muted);
    font-weight: 400;
  }
  .price {
    margin-left: auto;
    color: var(--muted);
  }
  .more {
    text-align: center;
    padding: 8px 16px 32px;
  }
  .none {
    padding: 24px 16px;
  }
  /* On a phone the Search/Deck tabs stick to the top, so the search bar sticks just below them. */
  @media (max-width: 860px) {
    .bar {
      top: 41px;
    }
  }
  @media (max-width: 560px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .bar {
      flex-wrap: wrap;
    }
    .bar input {
      order: -1;
      flex-basis: 100%;
    }
    .target {
      flex: 1;
    }
    .target button {
      flex: 1;
    }
  }
</style>
