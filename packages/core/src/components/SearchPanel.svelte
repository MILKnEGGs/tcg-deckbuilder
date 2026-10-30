<script lang="ts" generics="C extends Card">
  // Card search: free text, filter chips from the game, sort, and a grid of cards to add.
  import { consideringCount, copies } from '../deck';
  import Badges from './Badges.svelte';
  import type { Card, CardData, CardIndex, Deck, FormatDef, GameDef } from '../types';
  import { fmtRelease, localDay, money } from '../util';

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
    onOpen: (c: C, list?: C[]) => void;
  } = $props();

  const PAGE = 90;

  let q = $state('');
  // What the results use: follows the box after a short pause, so typing stays smooth on phones.
  let term = $state('');
  let box = $state<HTMLInputElement>();
  let sel = $state<Record<string, (string | number)[]>>({});
  let fit = $state(false);
  let toggled = $state<Record<string, boolean>>({});
  // Sort by cost (the default where cards have one, else name), name, price or any filter, in the filter's
  // own order; `desc` flips it.
  const defaultSort = () => (game.noCostCurve ? 'name' : 'cost');
  let sort = $state(defaultSort());
  let desc = $state(false);
  let limit = $state(PAGE);
  let showFilters = $state(false);
  let showIllegal = $state(false);
  const maybe = $derived(target === 'considering' && !onlyZone);
  const today = localDay();

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

  const sorts = $derived.by(() => {
    const out = [{ id: 'name', label: 'Name' }, ...(game.noCostCurve ? [] : [{ id: 'cost', label: 'Cost' }]), { id: 'price', label: 'Price' }];
    if (data.cards.some((c) => c.released)) out.push({ id: 'released', label: 'Release' });
    for (const f of game.filters) if (!out.some((o) => o.label.toLowerCase() === f.label.toLowerCase())) out.push({ id: `f:${f.id}`, label: f.label });
    return out;
  });
  /** Each filter value's position in its chip order, for sorting by that filter. */
  const rank = $derived(Object.fromEntries(game.filters.map((f) => [f.id, new Map(options[f.id].map((o, i) => [o, i]))])));
  const sorted = $derived(sort !== defaultSort() || desc);

  const zoneName = $derived(onlyZone ? (format.zones.find((z) => z.id === onlyZone)?.name ?? onlyZone) : '');
  const fitAuto = $derived(!!game.fit?.auto?.(deck, index));
  $effect(() => {
    fit = fitAuto;
  });
  const activeCount = $derived(Object.values(sel).reduce((n, v) => n + v.length, 0) + (fit ? 1 : 0) + Object.values(toggled).filter(Boolean).length);

  // Cards the format doesn't allow (rotated out, suspended) are hidden unless asked for.
  const illegalIds = $derived(game.illegal ? new Set(data.cards.filter((c) => game.illegal!(c, format)).map((c) => c.id)) : new Set<string>());
  type P = (typeof prepared)[number];
  const found = $derived.by(() => {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
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
        for (const t of game.toggles ?? []) if (toggled[t.id] && !t.test(p.c, deck, index)) return false;
        if (!showIllegal && illegalIds.has(p.c.id)) {
          hidden++;
          return false;
        }
        return true;
      });
    const byName = (a: P, b: P) => game.label(a.c).localeCompare(game.label(b.c));
    // The sort key; cards without one (no price, no value for that filter) always go last.
    const key = (p: P): number | null => {
      if (sort === 'cost') return game.cost(p.c);
      if (sort === 'price') return p.c.price ?? null;
      if (sort === 'released') return p.c.released ? Date.parse(p.c.released) : null;
      const order = rank[sort.slice(2)];
      const at = (p.values[sort.slice(2)] ?? []).map((v) => order?.get(v)).filter((i): i is number => i != null);
      return at.length ? Math.min(...at) : null;
    };
    const dir = desc ? -1 : 1;
    const cmp = (a: P, b: P) => {
      if (sort === 'name') return dir * byName(a, b);
      const ka = key(a);
      const kb = key(b);
      if (ka == null || kb == null) return ka == null && kb == null ? byName(a, b) : ka == null ? 1 : -1;
      return dir * (ka - kb) || byName(a, b);
    };
    return { cards: out.sort(cmp).map((p) => p.c), hidden };
  });
  const results = $derived(found.cards);

  // New search or filters start back at the first page.
  $effect(() => {
    void [term, sel, fit, toggled, sort, desc, onlyZone, showIllegal];
    limit = PAGE;
  });
  $effect(() => {
    const next = q;
    if (!next) {
      term = '';
      return;
    }
    const t = setTimeout(() => (term = next), 150);
    return () => clearTimeout(t);
  });

  /** The × in the search box: empty it and keep typing. */
  function clearSearch() {
    q = '';
    term = '';
    term = '';
    box?.focus();
  }

  function toggle(id: string, v: string | number) {
    const cur = sel[id] ?? [];
    sel = { ...sel, [id]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
  }

  function clearAll() {
    sort = defaultSort();
    desc = false;
    sel = {};
    fit = fitAuto;
    toggled = {};
    q = '';
    onlyZone = null;
  }
</script>

<div class="bar">
  <div class="target" role="group" aria-label="Add cards to">
    <button class:on={target === 'deck'} onclick={() => (target = 'deck')}>Deck</button>
    <button class:on={target === 'considering'} class="maybe" onclick={() => (target = 'considering')}>Considering</button>
  </div>
  <span class="searchbox">
    <input
      type="search"
      placeholder="Search name, text, traits…"
      bind:value={q}
      bind:this={box}
      onkeydown={(e) => e.key === 'Escape' && q && clearSearch()}
      enterkeyhint="search"
      autocomplete="off"
      aria-label="Search cards"
    />
    {#if q}<button class="clear-q" onclick={clearSearch} aria-label="Clear search" title="Clear search">×</button>{/if}
  </span>
  <select bind:value={sort} onchange={() => (desc = sort === 'released')} aria-label="Sort by" title="Sort by">
    {#each sorts as o (o.id)}<option value={o.id}>{o.id === 'name' ? 'Name' : `By ${o.label.toLowerCase()}`}</option>{/each}
  </select>
  <button class="dir" onclick={() => (desc = !desc)} title={desc ? 'Descending: tap for ascending' : 'Ascending: tap for descending'} aria-label={desc ? 'Sorted descending' : 'Sorted ascending'}>
    {desc ? '↓' : '↑'}
  </button>
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
  {#each game.toggles ?? [] as t (t.id)}
    <label class="fit"><input type="checkbox" checked={!!toggled[t.id]} onchange={(e) => (toggled = { ...toggled, [t.id]: e.currentTarget.checked })} /> {t.label}</label>
  {/each}
</div>

<div class="status small muted">
  {#if onlyZone}
    <button class="chip on" onclick={() => (onlyZone = null)}>Choosing: {zoneName} ✕</button>
  {/if}
  <span class="num">{results.length.toLocaleString()} cards</span>
  {#if activeCount - (fit && fitAuto ? 1 : 0) || fit !== fitAuto || q || onlyZone || sorted}<button class="ghost small" onclick={clearAll}>Clear</button>{/if}
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
    {@const max = game.maxCopies(c, format, deck, index)}
    {@const bad = illegalIds.has(c.id)}
    <div class="tile" class:wide={img.landscape} class:in={n > 0} class:considered={m > 0 && !n} class:bad>
      <button class="art" onclick={() => onOpen(c, results)} title={game.label(c)}>
        <img src={img.src} alt={game.label(c)} loading="lazy" decoding="async" />
        {#if m}<span class="badge maybe-badge num">?{m}</span>{/if}
        {#if bad}<span class="badge bad-badge">Not legal</span>{/if}
        {#if game.badges}<span class="symbols"><Badges badges={game.badges(c)} /></span>{/if}
        {#if sort === 'released' && c.released}<span class="badge date-badge" class:coming={c.released > today}>{fmtRelease(c.released, true)}</span>{/if}
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
        <span class="price num small">{c.price == null && game.priceNote?.(c) ? game.priceNote(c) : money(c.price)}</span>
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
  .searchbox {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
  }
  .searchbox input {
    flex: 1;
    min-width: 0;
    padding-right: 34px;
  }
  /* Our own × instead of the browser's, which phones don't show. */
  .searchbox input::-webkit-search-cancel-button {
    appearance: none;
  }
  .clear-q {
    position: absolute;
    top: 50%;
    right: 4px;
    transform: translateY(-50%);
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    font-size: 1.2rem;
    line-height: 1;
  }
  .clear-q:hover {
    color: var(--text);
    background: var(--panel-2);
  }
  .bar select {
    max-width: 9.5em;
  }
  .dir {
    flex: none;
    width: 34px;
    padding: 0;
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
  /* Sorted by release: each card's date, so you can see where a set starts. */
  .date-badge {
    top: auto;
    bottom: 6px;
    background: rgb(0 0 0 / 0.75);
    color: #fff;
    font-weight: 600;
  }
  .date-badge.coming {
    background: var(--accent);
  }
  .symbols {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 2px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.7);
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
    /* Phones: search and Filters on top; Deck/Considering and the sort below. */
    .searchbox {
      order: -2;
      flex: 1 1 60%;
    }
    .bar .toggle {
      order: -1;
    }
    .target {
      flex: none;
    }
    .bar select {
      flex: 1 1 0;
      min-width: 0;
      max-width: none;
    }
    .target button {
      flex: 1;
    }
  }
</style>
