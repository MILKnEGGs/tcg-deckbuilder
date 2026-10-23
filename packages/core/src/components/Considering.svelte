<script lang="ts" generics="C extends Card">
  // The Considering list: maybes beside the deck, shown in yellow, each with a button to move it in.
  import { cycleOwned } from '../deck';
  import type { Card, CardIndex, Deck, GameDef } from '../types';
  import { money } from '../util';

  let {
    game,
    index,
    deck,
    changed,
    onConsider,
    onPromote,
    onOpen,
  }: {
    game: GameDef<C>;
    index: CardIndex<C>;
    deck: Deck;
    changed: () => void;
    onConsider: (c: C, n?: number) => void;
    onPromote: (c: C) => void;
    onOpen: (c: C) => void;
  } = $props();

  const rows = $derived(
    (deck.considering ?? [])
      .map((e) => ({ e, c: index.get(e.id) }))
      .sort((a, b) => (a.c && b.c ? (game.cost(a.c) ?? 0) - (game.cost(b.c) ?? 0) || game.label(a.c).localeCompare(game.label(b.c)) : 0)),
  );
</script>

{#if rows.length}
  <section class="considering">
    <h3>Considering <span class="num">{rows.reduce((n, r) => n + r.e.qty, 0)}</span></h3>
    <p class="small muted">Not part of the deck. Move cards in when you decide.</p>
    <ul>
      {#each rows as { e, c } (e.id)}
        {@const miss = c && game.fit ? game.fit.miss(c, deck, index) : null}
        <li>
          <span class="qty">
            <button class="step" onclick={() => c && onConsider(c, -1)} aria-label="Consider one fewer">−</button>
            <span class="num">{e.qty}</span>
            <button class="step" onclick={() => c && onConsider(c)} disabled={!c} aria-label="Consider one more">+</button>
          </span>
          <button class="cname" onclick={() => c && onOpen(c)}>
            {#if c && game.cost(c) != null}<span class="cost num">{game.cost(c)}</span>{/if}
            <span class="label">{c ? game.label(c) : e.id}</span>
            {#if miss}<span class="miss small">{miss}</span>{/if}
          </button>
          <button
            class="owned num"
            class:all={e.owned >= e.qty}
            onclick={() => {
              cycleOwned(deck, 'considering', e.id);
              changed();
            }}
            title="Tap to mark the copies you own"
          >
            {e.owned >= e.qty ? '✓' : ''}{e.qty > 1 ? `${e.owned}/${e.qty}` : e.owned ? '' : 'Own?'}
          </button>
          <span class="price num small">{money(c?.price != null ? c.price * e.qty : null)}</span>
          <button class="in small" onclick={() => c && onPromote(c)} disabled={!c} title="Move one copy into the deck">→ Deck</button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .considering {
    margin: 8px 16px 12px;
    padding: 8px 10px 10px;
    border-radius: var(--radius);
    background: var(--maybe-bg);
    border: 1px solid color-mix(in srgb, var(--maybe) 45%, transparent);
  }
  h3 {
    font-size: 0.95rem;
    margin: 2px 0 0;
    color: var(--maybe);
  }
  p {
    margin: 0 0 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
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
  .miss {
    flex: none;
    color: var(--warning);
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
  .owned.all {
    color: var(--ok);
    border-color: var(--ok);
  }
  .price {
    flex: none;
    width: 56px;
    text-align: right;
    color: var(--muted);
  }
  .in {
    flex: none;
    padding: 4px 8px;
    background: var(--maybe);
    border-color: var(--maybe);
    color: var(--maybe-ink);
    font-weight: 600;
  }
</style>
