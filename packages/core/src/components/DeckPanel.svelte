<script lang="ts" generics="C extends Card">
  // The Build view's deck list: summary, command cards (leaders/bases), the list by group, Considering.
  import { cycleOwned, setQty, zoneCount } from '../deck';
  import type { Card, CardIndex, Deck, Entry, FormatDef, GameDef, Issue } from '../types';
  import { money } from '../util';
  import Badges from './Badges.svelte';
  import Considering from './Considering.svelte';
  import CostCurve from './CostCurve.svelte';
  import DeckActions from './DeckActions.svelte';
  import DeckDescription from './DeckDescription.svelte';
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
  } = $props();

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
    const order = (g: string) => game.groups.indexOf(g) + 1 || 99;
    return [...groups.entries()]
      .sort(([a], [b]) => order(a) - order(b))
      .map(([g, list]) => [
        g,
        list.sort((a, b) => (a.c && b.c ? (game.cost(a.c) ?? 0) - (game.cost(b.c) ?? 0) || game.label(a.c).localeCompare(game.label(b.c)) : 0)),
      ]);
  }

  function owned(zone: string, e: Entry) {
    cycleOwned(deck, zone, e.id);
    changed();
  }
  function drop(zone: string, id: string) {
    setQty(deck, zone, id, 0);
    changed();
  }
</script>

<DeckSummary {game} {index} {deck} {format} {issues} />

<div class="command">
  {#each commandZones as z (z.id)}
    <!-- One tile per copy, or one per card with a label ("Elite") for games where copies mean dice. -->
    {@const list = (deck.zones[z.id] ?? []).flatMap((e) => (game.qtyLabel ? [{ id: e.id, qty: e.qty }] : Array.from({ length: e.qty }, () => ({ id: e.id, qty: 1 }))))}
    {#each list as { id, qty }, i (id + i)}
      {@const c = index.get(id)}
      {@const tag = c && game.qtyLabel ? game.qtyLabel(c, qty) : null}
      <div class="slot" class:flag-error={flagged.get(id) === 'error'} class:tall={c && !game.image(c).landscape}>
        {#if c}
          <button class="slot-art" onclick={() => onOpen(c)} title={game.label(c)}>
            <img src={game.image(c).src} alt={game.label(c)} />
          </button>
          {#if tag}<span class="slot-tag">{tag}</span>{/if}
          <button class="slot-x" onclick={() => onRemove(c, z.id)} aria-label="Remove {game.label(c)}">✕</button>
        {:else}
          <span class="muted small">{id}</span>
        {/if}
      </div>
    {/each}
    {#each Array.from({ length: Math.max(0, Math.min(z.placeholders ?? z.max, z.max - zoneCount(deck, z.id))) }) as _, i (i)}
      <button class="slot empty" onclick={() => onPick(z.id)}>+ {z.name.replace(/s$/, '')}</button>
    {/each}
  {/each}
</div>

{#snippet row(zone: string, e: Entry, c: C | undefined)}
  <li class:flag-error={flagged.get(e.id) === 'error'} class:flag-warning={flagged.get(e.id) === 'warning'}>
    <span class="qty">
      <button class="step" onclick={() => (c ? onRemove(c, zone) : drop(zone, e.id))} aria-label="Remove one">−</button>
      <span class="num">{e.qty}</span>
      <button class="step" onclick={() => c && onAdd(c, zone)} disabled={!c} aria-label="Add one">+</button>
    </span>
    <button class="cname" onclick={() => c && onOpen(c)}>
      {#if c && game.cost(c) != null}<span class="cost num">{game.cost(c)}</span>{/if}
      <span class="namebox">
        <span class="label">{c ? game.label(c) : e.id}</span>
        {#if c && game.badges}<Badges badges={game.badges(c)} size="mini" />{/if}
      </span>
    </button>
    <button class="demote" onclick={() => c && onDemote(c, zone)} disabled={!c} title="Move one copy to Considering (a possible cut)" aria-label="Move one to Considering">?</button>
    <button
      class="owned num"
      class:all={e.owned >= e.qty}
      class:some={e.owned > 0 && e.owned < e.qty}
      onclick={() => owned(zone, e)}
      title="Tap to mark the copies you own"
    >
      {e.owned >= e.qty ? '✓' : ''}{e.qty > 1 ? `${e.owned}/${e.qty}` : e.owned ? '' : 'Own?'}
    </button>
    {#if game.setCode}{@const set = c ? game.setCode(c) : null}<span class="set small" title={set ?? ''}>{set ?? ''}</span>{/if}
    <span class="price num small">{c?.price == null && c && game.priceNote?.(c) ? game.priceNote(c) : money(c?.price != null ? c.price * e.qty : null)}</span>
  </li>
{/snippet}

<!-- Heroes, leaders and bases as rows too, for their price and the Own toggle. -->
{#if commandZones.some((z) => deck.zones[z.id]?.length)}
  <section class="zone lead-rows">
    {#each commandZones as z (z.id)}
      {@const list = (deck.zones[z.id] ?? []).map((e) => ({ e, c: index.get(e.id) }))}
      {#if list.length}
        <h4>{z.name} <span class="num">{zoneCount(deck, z.id)}</span></h4>
        <ul class="rows">
          {#each list as { e, c } (e.id)}
            {@render row(z.id, e, c)}
          {/each}
        </ul>
      {/if}
    {/each}
  </section>
{/if}

<Considering {game} {index} {deck} {changed} {onConsider} {onPromote} {onOpen} />

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
            {@render row(z.id, e, c)}
          {/each}
        </ul>
      {/each}
    </section>
  {/if}
{/each}

{#if !game.noCostCurve}
  <section class="zone">
    <h3>Cost curve</h3>
    <CostCurve {game} {index} {deck} />
  </section>
{/if}

<DeckDescription {deck} {changed} />

<DeckActions {game} {index} {deck} {format} {changed} {say} />

<style>
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
  /* Portrait leaders (One Piece) instead of landscape ones (SWU). */
  .slot.tall {
    aspect-ratio: 63 / 88;
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
  .slot-tag {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 0.72rem;
    font-weight: 700;
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
    container-type: inline-size;
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
  .step,
  .demote {
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
  .demote:hover:not(:disabled) {
    color: var(--maybe);
    border-color: var(--maybe);
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
  .namebox {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
  }
  .label {
    max-width: 100%;
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
  /* The set column only where the list is wide (desktop Deck view), not in the Build sidebar or on phones. */
  .set {
    display: none;
    flex: none;
    width: 84px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @container (min-width: 560px) {
    .set {
      display: block;
    }
  }
  .price {
    flex: none;
    width: 62px;
    text-align: right;
    color: var(--muted);
  }
</style>
