<script lang="ts" generics="C extends Card">
  // A card up close: big image (flip for double-sided), details, rules text, and add/remove.
  import { onMount } from 'svelte';
  import { consideringCount, copies } from '../deck';
  import Badges from './Badges.svelte';
  import type { Card, CardIndex, Deck, FormatDef, GameDef } from '../types';

  let {
    game,
    index,
    deck,
    format,
    card,
    onAdd,
    onRemove,
    onConsider,
    onPromote,
    onDemote,
    onClose,
  }: {
    game: GameDef<C>;
    index: CardIndex<C>;
    deck: Deck;
    format: FormatDef;
    card: C;
    onAdd: (c: C, zone?: string) => void;
    onRemove: (c: C, zone?: string) => void;
    onConsider: (c: C, n?: number) => void;
    onPromote: (c: C) => void;
    onDemote: (c: C, zone: string) => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let flipped = $state(false);
  const img = $derived(game.image(card));
  const n = $derived(copies(deck, card.id));
  const max = $derived(game.maxCopies(card, format, deck, index));
  const home = $derived(game.zoneFor(card, format));
  const hasSide = $derived(home === 'main' && format.zones.some((z) => z.id === 'side'));
  const inSide = $derived(copies(deck, card.id, ['side']));
  const maybe = $derived(consideringCount(deck, card.id));
  const why = $derived(game.illegal?.(card, format) ?? null);

  onMount(() => dialog?.showModal());
</script>

<dialog bind:this={dialog} onclose={onClose} onclick={(e) => e.target === dialog && dialog?.close()}>
  <div class="body">
    <div class="pic" class:wide={img.landscape}>
      <img src={flipped && img.back ? img.back : img.src} alt={game.label(card)} />
      {#if img.back}
        <button class="small" onclick={() => (flipped = !flipped)}>{flipped ? 'Show front' : 'Show back'}</button>
      {/if}
    </div>
    <div class="info">
      <h2>{game.label(card)}</h2>
      {#if game.badges}<div class="symbols"><Badges badges={game.badges(card)} size="large" /></div>{/if}
      <dl>
        {#each game.details(card) as [k, v] (k)}
          <dt>{k}</dt>
          <dd>{v}</dd>
        {/each}
      </dl>
      {#each game.text(card) as p, i (i)}
        <p class="text">{p}</p>
      {/each}

      {#if why}
        <p class="illegal small">Not allowed in {format.name}: {why}.</p>
      {/if}
      {#if home}
        <div class="add">
          <button onclick={() => onRemove(card, home)} disabled={!copies(deck, card.id, [home])}>−</button>
          <span class="num">{n} in deck{max < 99 ? ` (max ${max})` : ''}</span>
          <button class="primary" onclick={() => onAdd(card)} disabled={n >= max || !!why}>+ Add</button>
        </div>
        {#if hasSide}
          <div class="add">
            <button onclick={() => onRemove(card, 'side')} disabled={!inSide}>−</button>
            <span class="num">{inSide} in sideboard</span>
            <button onclick={() => onAdd(card, 'side')} disabled={n >= max || !!why}>+ Side</button>
          </div>
        {/if}
        <div class="add maybe">
          <button onclick={() => onConsider(card, -1)} disabled={!maybe}>−</button>
          <span class="num">{maybe} considering</span>
          <button onclick={() => onConsider(card)}>+ Consider</button>
        </div>
        <div class="moves">
          {#if maybe}
            <button class="to-deck" onclick={() => onPromote(card)} disabled={n >= max || !!why}>Move 1 into the deck</button>
          {/if}
          {#if copies(deck, card.id, [home])}
            <button class="to-maybe" onclick={() => onDemote(card, home)}>Move 1 to Considering (maybe cut)</button>
          {/if}
        </div>
      {:else}
        <p class="muted small">Can't be used in {format.name}.</p>
      {/if}
      {#if card.tcg}
        <a class="small" href="https://www.tcgplayer.com/product/{card.tcg}" target="_blank" rel="noopener">View on TCGplayer ↗</a>
      {/if}
    </div>
  </div>
  <button class="close ghost" onclick={() => dialog?.close()} aria-label="Close">✕</button>
</dialog>

<style>
  dialog {
    max-width: min(820px, calc(100vw - 24px));
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
    gap: 20px;
    padding: 20px;
  }
  .pic {
    display: grid;
    gap: 8px;
    justify-items: center;
    align-content: start;
  }
  .pic img {
    width: 100%;
    border-radius: 12px;
    display: block;
  }
  .body:has(.pic.wide) {
    grid-template-columns: 1fr;
  }
  .pic.wide img {
    max-width: 480px;
  }
  h2 {
    margin: 0 36px 10px 0;
    font-size: 1.25rem;
  }
  .symbols {
    margin: -4px 0 12px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0 0 12px;
    font-size: 0.9rem;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .text {
    background: var(--panel-2);
    border-radius: 8px;
    padding: 10px 12px;
    margin: 0 0 8px;
    font-size: 0.92rem;
    white-space: pre-line;
  }
  .add {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 12px 0 0;
  }
  .add span {
    flex: 1;
    text-align: center;
  }
  .add + .add {
    margin-top: 8px;
  }
  .add.maybe span {
    color: var(--maybe);
  }
  .add.maybe button:last-child {
    border-color: var(--maybe);
  }
  .moves {
    display: grid;
    gap: 6px;
    margin-top: 8px;
  }
  .to-deck {
    background: var(--maybe);
    border-color: var(--maybe);
    color: var(--maybe-ink);
    font-weight: 600;
  }
  .to-maybe {
    background: transparent;
    border-style: dashed;
    border-color: var(--maybe);
    color: var(--maybe);
  }
  .illegal {
    color: var(--error);
    margin: 8px 0 0;
  }
  .info > a {
    display: inline-block;
    margin-top: 14px;
  }
  .close {
    position: absolute;
    top: 10px;
    right: 10px;
  }
  @media (max-width: 640px) {
    .body {
      grid-template-columns: 1fr;
      padding: 14px;
    }
    .pic img {
      max-width: 300px;
    }
  }
</style>
