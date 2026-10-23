<script lang="ts" generics="C extends Card">
  // The whole app: loads the card data once, then shows the deck list (#/) or one deck (#/deck/<id>).
  import { onMount } from 'svelte';
  import { useRegisterSW } from 'virtual:pwa-register/svelte';
  import { requestPersistence, useDatabase } from '../db';
  import { indexCards } from '../deck';
  import type { Card, CardData, CardIndex, GameDef } from '../types';
  import Editor from './Editor.svelte';
  import Home from './Home.svelte';

  let { game }: { game: GameDef<C> } = $props();

  // svelte-ignore state_referenced_locally
  useDatabase(game.id);

  let data = $state.raw<CardData<C> | null>(null);
  let index = $state.raw<CardIndex<C>>(new Map());
  let error = $state('');
  let hash = $state(location.hash);
  const deckId = $derived(/^#\/deck\/(.+)$/.exec(hash)?.[1] ?? null);

  const { needRefresh, updateServiceWorker } = useRegisterSW();

  onMount(() => {
    requestPersistence();
    fetch('data/cards.json')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<CardData<C>>;
      })
      .then((d) => {
        data = d;
        index = indexCards(d);
      })
      .catch((e) => (error = String(e.message ?? e)));
    const onHash = () => (hash = location.hash);
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  });
</script>

{#if $needRefresh}
  <div class="update">
    <span>A new version is ready{data ? ' (with fresh prices)' : ''}.</span>
    <button class="primary" onclick={() => updateServiceWorker(true)}>Update</button>
    <button class="ghost" onclick={() => needRefresh.set(false)}>Later</button>
  </div>
{/if}

{#if error}
  <main class="center">
    <h1>{game.title}</h1>
    <p>Couldn't load the card data: {error}</p>
    <p class="muted small">If you're running it locally, run <code>npm run data</code> first.</p>
  </main>
{:else if !data}
  <main class="center"><p class="muted">Loading cards…</p></main>
{:else if deckId}
  {#key deckId}
    <Editor {game} {data} {index} id={deckId} />
  {/key}
{:else}
  <Home {game} {data} {index} />
{/if}

<style>
  .center {
    min-height: 100dvh;
    display: grid;
    place-content: center;
    text-align: center;
    padding: 16px;
  }
  .update {
    position: fixed;
    z-index: 50;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 8px 8px 14px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow);
    width: max-content;
    max-width: calc(100vw - 24px);
  }
</style>
