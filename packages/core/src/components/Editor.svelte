<script lang="ts" generics="C extends Card">
  // One deck: search on the left, the deck on the right (tabs on a phone). Saves as you go.
  import { onMount } from 'svelte';
  import { deleteDeck, getDeck, putDeck } from '../db';
  import { addCard, changeFormat, setQty } from '../deck';
  import type { Card, CardData, CardIndex, Deck, GameDef } from '../types';
  import CardModal from './CardModal.svelte';
  import DeckPanel from './DeckPanel.svelte';
  import SearchPanel from './SearchPanel.svelte';

  let { game, data, index, id }: { game: GameDef<C>; data: CardData<C>; index: CardIndex<C>; id: string } = $props();

  let deck = $state<Deck | null>(null);
  let missing = $state(false);
  let tab = $state<'search' | 'deck'>('search');
  let onlyZone = $state<string | null>(null);
  let viewing = $state<C | null>(null);
  let toast = $state('');
  let toastTimer: ReturnType<typeof setTimeout>;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const format = $derived(deck ? (game.formats.find((f) => f.id === deck!.format) ?? game.formats[0]) : game.formats[0]);
  const issues = $derived(deck ? game.validate(deck, index, format) : []);

  onMount(() => {
    getDeck(id).then((d) => {
      if (d) {
        // Make sure every zone of the format exists, even for decks saved by an older version.
        const f = game.formats.find((x) => x.id === d.format) ?? game.formats[0];
        for (const z of f.zones) d.zones[z.id] ??= [];
        deck = d;
      } else missing = true;
    });
    const flush = () => saveNow();
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('pagehide', flush);
      saveNow();
    };
  });

  function saveNow() {
    if (saveTimer === undefined || !deck) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    putDeck(deck);
  }

  function changed() {
    if (!deck) return;
    deck.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  function say(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 2500);
  }

  function add(card: C, zone?: string) {
    if (!deck) return;
    const z = zone ?? game.zoneFor(card, format);
    const def = format.zones.find((x) => x.id === z);
    // A full single-card slot (a leader or base in most formats) swaps instead of refusing.
    if (def?.command && def.max === 1 && (deck.zones[def.id]?.length ?? 0) > 0) deck.zones[def.id] = [];
    const err = addCard(game, deck, format, card, z ?? undefined);
    if (err) say(err);
    else {
      changed();
      if (def?.command && onlyZone === def.id && (deck.zones[def.id] ?? []).reduce((n, e) => n + e.qty, 0) >= def.max) onlyZone = null;
    }
  }

  function remove(card: C, zone?: string) {
    if (!deck) return;
    // Without a zone, take it from wherever there are copies, main deck last.
    const zones = zone ? [zone] : format.zones.map((z) => z.id).sort((a, b) => Number(a === 'main') - Number(b === 'main'));
    for (const z of zones) {
      const e = deck.zones[z]?.find((x) => x.id === card.id);
      if (e) {
        setQty(deck, z, card.id, e.qty - 1);
        changed();
        return;
      }
    }
  }

  function setFormat(to: string) {
    if (!deck || to === deck.format) return;
    changeFormat(deck, format, game.formats.find((f) => f.id === to)!);
    changed();
  }

  function pick(zone: string) {
    onlyZone = zone;
    tab = 'search';
  }

  async function removeDeck() {
    if (!deck || !confirm(`Delete "${deck.name}"? This can't be undone.`)) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    await deleteDeck(deck.id);
    location.hash = '#/';
  }

  const deckCount = $derived(deck ? Object.values(deck.zones).reduce((n, l) => n + l.reduce((m, e) => m + e.qty, 0), 0) : 0);
</script>

{#if missing}
  <main class="missing">
    <p>That deck doesn't exist on this device.</p>
    <a href="#/">Back to decks</a>
  </main>
{:else if deck}
<div class="editor">
  <header>
    <a class="back" href="#/" aria-label="Back to decks">‹ Decks</a>
    <input class="name" type="text" bind:value={deck.name} oninput={changed} aria-label="Deck name" />
    <select value={deck.format} onchange={(e) => setFormat(e.currentTarget.value)} aria-label="Format">
      {#each game.formats as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
    </select>
    <button class="ghost danger small" onclick={removeDeck}>Delete</button>
  </header>

  <nav class="tabs">
    <button class:on={tab === 'search'} onclick={() => (tab = 'search')}>Search</button>
    <button class:on={tab === 'deck'} onclick={() => (tab = 'deck')}>
      Deck <span class="num">{deckCount}</span>
      {#if issues.some((i) => i.level === 'error')}<span class="dot err"></span>{:else if issues.length}<span class="dot warn"></span>{/if}
    </button>
  </nav>

  <div class="layout">
    <section class="search" class:hide={tab !== 'search'}>
      <SearchPanel {game} {data} {index} {deck} {format} bind:onlyZone onAdd={add} onRemove={remove} onOpen={(c) => (viewing = c)} />
    </section>
    <section class="deck" class:hide={tab !== 'deck'}>
      <DeckPanel {game} {index} {deck} {format} {issues} {changed} {say} onAdd={add} onRemove={remove} onOpen={(c) => (viewing = c)} onPick={pick} />
    </section>
  </div>

  {#if viewing}
    <CardModal {game} {deck} {format} card={viewing} onAdd={add} onRemove={remove} onClose={() => (viewing = null)} />
  {/if}

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</div>
{/if}

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }
  .back {
    text-decoration: none;
    white-space: nowrap;
    font-weight: 600;
  }
  .name {
    flex: 1;
    font-weight: 600;
    font-size: 1.05rem;
    background: transparent;
    border-color: transparent;
  }
  .name:hover,
  .name:focus {
    border-color: var(--line);
  }
  .tabs {
    display: none;
  }
  .editor {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }
  .layout {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 420px;
  }
  .layout > section {
    overflow-y: auto;
    min-height: 0;
  }
  .deck {
    border-left: 1px solid var(--line);
    background: var(--panel);
  }
  .missing {
    padding: 40px 16px;
    text-align: center;
  }
  .toast {
    position: fixed;
    z-index: 60;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    background: var(--panel-2);
    border: 1px solid var(--line);
    padding: 10px 16px;
    border-radius: 10px;
    box-shadow: var(--shadow);
    max-width: calc(100vw - 32px);
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-left: 4px;
    vertical-align: middle;
  }
  .dot.err {
    background: var(--error);
  }
  .dot.warn {
    background: var(--warning);
  }

  @media (max-width: 860px) {
    header {
      flex-wrap: wrap;
      padding: 8px 12px;
    }
    .name {
      order: 3;
      flex-basis: 100%;
    }
    .tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      position: sticky;
      top: 0;
      z-index: 9;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
    }
    .tabs button {
      border: 0;
      border-radius: 0;
      background: none;
      padding: 10px;
      border-bottom: 2px solid transparent;
      color: var(--muted);
    }
    .tabs button.on {
      color: var(--text);
      border-bottom-color: var(--accent);
    }
    .editor {
      display: block;
      height: auto;
    }
    .layout {
      display: block;
    }
    .layout > section {
      overflow: visible;
    }
    .deck {
      border-left: 0;
      min-height: 60vh;
    }
    .hide {
      display: none;
    }
  }
</style>
