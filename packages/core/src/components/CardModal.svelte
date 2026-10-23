<script lang="ts" generics="C extends Card">
  // A card up close: big image (flip for double-sided), details, rules text, and add/remove.
  import { onMount } from 'svelte';
  import { copies } from '../deck';
  import type { Card, Deck, FormatDef, GameDef } from '../types';

  let {
    game,
    deck,
    format,
    card,
    onAdd,
    onRemove,
    onClose,
  }: {
    game: GameDef<C>;
    deck: Deck;
    format: FormatDef;
    card: C;
    onAdd: (c: C, zone?: string) => void;
    onRemove: (c: C, zone?: string) => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let flipped = $state(false);
  const img = $derived(game.image(card));
  const n = $derived(copies(deck, card.id));
  const max = $derived(game.maxCopies(card, format));
  const home = $derived(game.zoneFor(card, format));
  const hasSide = $derived(home === 'main' && format.zones.some((z) => z.id === 'side'));
  const inSide = $derived(copies(deck, card.id, ['side']));

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
      <dl>
        {#each game.details(card) as [k, v] (k)}
          <dt>{k}</dt>
          <dd>{v}</dd>
        {/each}
      </dl>
      {#each game.text(card) as p, i (i)}
        <p class="text">{p}</p>
      {/each}

      {#if home}
        <div class="add">
          <button onclick={() => onRemove(card, home)} disabled={!copies(deck, card.id, [home])}>−</button>
          <span class="num">{n} in deck{max < 99 ? ` (max ${max})` : ''}</span>
          <button class="primary" onclick={() => onAdd(card)} disabled={n >= max}>+ Add</button>
        </div>
        {#if hasSide}
          <div class="add">
            <button onclick={() => onRemove(card, 'side')} disabled={!inSide}>−</button>
            <span class="num">{inSide} in sideboard</span>
            <button onclick={() => onAdd(card, 'side')} disabled={n >= max}>+ Side</button>
          </div>
        {/if}
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
