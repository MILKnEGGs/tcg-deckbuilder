<script lang="ts" generics="C extends Card">
  // The deck list: every saved deck with its size and price, plus new deck and import.
  import { onMount } from 'svelte';
  import { deleteDeck, listDecks, putDeck } from '../db';
  import { newDeck, sizeOf, totals } from '../deck';
  import { takeConsidering } from '../considering';
  import { takeDescription } from '../description';
  import type { Card, CardData, CardIndex, Deck, GameDef, Imported } from '../types';
  import { fmtDate, money, plural, uid } from '../util';

  let { game, data, index }: { game: GameDef<C>; data: CardData<C>; index: CardIndex<C> } = $props();

  let decks = $state<Deck[]>([]);
  let loaded = $state(false);

  let newDialog = $state<HTMLDialogElement>();
  let newName = $state('');
  // svelte-ignore state_referenced_locally
  let newFormat = $state(game.formats[0].id);

  let importDialog = $state<HTMLDialogElement>();
  let importText = $state('');
  let importError = $state('');
  let imported = $state<Imported | null>(null);
  // svelte-ignore state_referenced_locally
  let importFormat = $state(game.formats[0].id);

  const sorted = $derived([...decks].sort((a, b) => b.updated - a.updated));
  const formatOf = (d: Deck) => game.formats.find((f) => f.id === d.format) ?? game.formats[0];

  onMount(async () => {
    decks = await listDecks();
    loaded = true;
  });

  const open = (d: Deck) => (location.hash = `#/deck/${d.id}`);

  async function create() {
    const f = game.formats.find((x) => x.id === newFormat)!;
    const d = newDeck(f, newName.trim() || `New ${f.name} deck`);
    await putDeck(d);
    newDialog?.close();
    open(d);
  }

  function readImport() {
    importError = '';
    imported = null;
    if (!importText.trim()) return;
    try {
      const { text, description } = takeDescription(importText);
      const maybe = takeConsidering(text, game, index, game.formats[0]);
      const list = game.importDeck(maybe.text, index, game.formats);
      imported = { ...list, skipped: [...list.skipped, ...maybe.skipped], ...(description ? { description } : {}), ...(maybe.considering ? { considering: maybe.considering } : {}) };
      if (imported.format) importFormat = imported.format;
    } catch (e) {
      importError = (e as Error).message;
    }
  }

  async function saveImport() {
    if (!imported) return;
    const f = game.formats.find((x) => x.id === importFormat)!;
    const d = newDeck(f, imported.name ?? `Imported ${f.name} deck`);
    if (imported.description) d.description = imported.description;
    if (imported.considering) d.considering = imported.considering.map((e) => ({ ...e }));
    for (const [zone, list] of Object.entries(imported.zones)) {
      // Zones this format lacks (a sideboard in a format without one) join the main deck.
      const target = f.zones.some((z) => z.id === zone) ? zone : 'main';
      for (const e of list) {
        const have = (d.zones[target] ??= []).find((x) => x.id === e.id);
        if (have) have.qty += e.qty;
        else d.zones[target].push({ ...e });
      }
    }
    await putDeck(d);
    importDialog?.close();
    open(d);
  }

  async function duplicate(d: Deck) {
    const copy: Deck = { ...JSON.parse(JSON.stringify(d)), id: uid(), name: `${d.name} (copy)`, created: Date.now(), updated: Date.now() };
    await putDeck(copy);
    decks = [...decks, copy];
  }

  async function remove(d: Deck) {
    if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return;
    await deleteDeck(d.id);
    decks = decks.filter((x) => x.id !== d.id);
  }

  function commandNames(d: Deck): string {
    const f = formatOf(d);
    return f.zones
      .filter((z) => z.command)
      .flatMap((z) => d.zones[z.id] ?? [])
      .map((e) => index.get(e.id)?.name ?? e.id)
      .join(' · ');
  }
</script>

<header>
  <div>
    <h1>{game.title}</h1>
    <p class="muted small">{game.game} · {data.cards.length.toLocaleString()} cards · prices from TCGplayer, {fmtDate(data.updated)}</p>
  </div>
  <div class="actions">
    <button onclick={() => { importText = ''; imported = null; importError = ''; importDialog?.showModal(); }}>Import</button>
    <button class="primary" onclick={() => { newName = ''; newDialog?.showModal(); }}>New deck</button>
  </div>
</header>

<main>
  {#if loaded && !decks.length}
    <div class="empty">
      <p>No decks yet.</p>
      <button class="primary" onclick={() => newDialog?.showModal()}>Build your first deck</button>
    </div>
  {/if}

  <ul class="decks">
    {#each sorted as d (d.id)}
      {@const f = formatOf(d)}
      {@const t = totals(d, index)}
      {@const n = sizeOf(d, f)}
      <li>
        <button class="deck" onclick={() => open(d)}>
          <span class="name">{d.name}</span>
          <span class="muted small">{f.name}{commandNames(d) ? ` · ${commandNames(d)}` : ''}</span>
          <span class="stats small">
            <span class="num" class:over={n > f.size.target} class:under={n < f.size.target}>{n}/{f.size.target} cards</span>
            <span class="num">Deck {money(t.total)}</span>
            <span class="num finish">To finish {money(t.toFinish)}</span>
          </span>
        </button>
        <div class="row-actions">
          <button class="ghost small" onclick={() => duplicate(d)}>Duplicate</button>
          <button class="ghost small danger" onclick={() => remove(d)}>Delete</button>
        </div>
      </li>
    {/each}
  </ul>
</main>

<dialog bind:this={newDialog}>
  <form method="dialog" onsubmit={(e) => { e.preventDefault(); create(); }}>
    <h2>New deck</h2>
    <label class="field">
      <span>Name</span>
      <input type="text" bind:value={newName} placeholder="Deck name" />
    </label>
    <fieldset>
      <legend>Format</legend>
      {#each game.formats as f (f.id)}
        <label class="format" class:on={newFormat === f.id}>
          <input type="radio" name="format" value={f.id} bind:group={newFormat} />
          <span><strong>{f.name}</strong>{#if f.recommended}{' '}<em>(Recommended)</em>{/if}<br /><span class="muted small">{f.summary}</span></span>
        </label>
      {/each}
    </fieldset>
    <div class="buttons">
      <button type="button" class="ghost" onclick={() => newDialog?.close()}>Cancel</button>
      <button type="submit" class="primary">Create</button>
    </div>
  </form>
</dialog>

<dialog bind:this={importDialog}>
  <form method="dialog" onsubmit={(e) => { e.preventDefault(); saveImport(); }}>
    <h2>Import a decklist</h2>
    <p class="muted small">{game.importHint}</p>
    <textarea rows="9" bind:value={importText} oninput={readImport} placeholder="Paste here"></textarea>
    {#if importError}<p class="error small">{importError}</p>{/if}
    {#if imported}
      {@const count = Object.values(imported.zones).flat().reduce((n, e) => n + e.qty, 0)}
      {@const maybeCount = (imported.considering ?? []).reduce((n, e) => n + e.qty, 0)}
      <p class="small">Found {plural(count, 'card')}{imported.name ? ` in "${imported.name}"` : ''}{maybeCount ? `, plus ${maybeCount} considering` : ''}.</p>
      {#if imported.skipped.length}
        <p class="error small">Not recognised ({imported.skipped.length}): {imported.skipped.slice(0, 8).join(', ')}{imported.skipped.length > 8 ? '…' : ''}</p>
      {/if}
      <label class="field">
        <span>Format</span>
        <select bind:value={importFormat}>
          {#each game.formats as f (f.id)}<option value={f.id}>{f.name}{f.recommended ? ' (Recommended)' : ''}</option>{/each}
        </select>
      </label>
    {/if}
    <div class="buttons">
      <button type="button" class="ghost" onclick={() => importDialog?.close()}>Cancel</button>
      <button type="submit" class="primary" disabled={!imported}>Import</button>
    </div>
  </form>
</dialog>

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
    align-items: center;
    padding: 20px 16px 12px;
    max-width: 900px;
    margin: 0 auto;
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
  }
  h1 + p {
    margin: 2px 0 0;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  main {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 16px 40px;
  }
  .empty {
    text-align: center;
    padding: 60px 0;
  }
  .decks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 10px;
  }
  .decks li {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 8px;
  }
  .deck {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: 0;
    padding: 14px 16px;
    display: grid;
    gap: 3px;
  }
  .name {
    font-weight: 600;
    font-size: 1.05rem;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin-top: 4px;
  }
  .finish {
    color: var(--accent);
  }
  .over {
    color: var(--warning);
  }
  .under {
    color: var(--muted);
  }
  .row-actions {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  form {
    padding: 18px;
    display: grid;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  form p {
    margin: 0;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field span {
    font-size: 0.85rem;
    color: var(--muted);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }
  legend {
    font-size: 0.85rem;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .format {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .format.on {
    border-color: var(--accent);
  }
  .format input {
    margin-top: 3px;
    accent-color: var(--accent);
  }
  textarea {
    width: 100%;
    resize: vertical;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.85rem;
  }
  .error {
    color: var(--error);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  @media (max-width: 560px) {
    .decks li {
      flex-direction: column;
      align-items: stretch;
      padding: 0 0 8px;
    }
    .row-actions {
      flex-direction: row;
      padding: 0 8px;
    }
  }
</style>
