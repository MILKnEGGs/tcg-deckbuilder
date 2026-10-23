<script lang="ts" generics="C extends Card">
  // Goldfish: draw sample hands and step through turns alone, plus the odds of early plays.
  import { onMount } from 'svelte';
  import { atLeastOne, mulligan, move, nextTurn, pile, setupDone, start, unplay, type Fish } from '../goldfish';
  import type { Card, CardIndex, Deck, FormatDef, GameDef, GoldfishDef } from '../types';

  let { game, index, deck, format, config, onClose }: { game: GameDef<C>; index: CardIndex<C>; deck: Deck; format: FormatDef; config: GoldfishDef; onClose: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  // svelte-ignore state_referenced_locally
  let fish = $state<Fish>(start(deck, config));
  let picked = $state<number | null>(null);

  onMount(() => dialog?.showModal());

  const commandCards = $derived(
    format.zones
      .filter((z) => z.command)
      .flatMap((z) => (deck.zones[z.id] ?? []).flatMap((e) => Array.from({ length: e.qty }, () => index.get(e.id))))
      .filter((c): c is C => !!c),
  );
  const ready = $derived(setupDone(fish, config));
  const needResources = $derived(config.resources ? Math.max(0, config.resources.setup - fish.resources.length) : 0);

  // Odds of having a card at or under each cost, in the opening hand and by the next two turns.
  const odds = $derived.by(() => {
    const ids = pile(deck, config.zones);
    const costs = ids.map((id) => {
      const c = index.get(id);
      return c ? game.cost(c) : null;
    });
    const seen = [config.hand, config.hand + config.draw, config.hand + config.draw * 2];
    return [1, 2, 3, 4].map((k) => {
      const hits = costs.filter((c) => c != null && c <= k).length;
      return { k, hits, p: seen.map((s) => atLeastOne(ids.length, hits, s)) };
    });
  });
  const pct = (p: number) => `${Math.round(p * 100)}%`;

  function act(to: 'resources' | 'played' | 'discard') {
    if (picked === null) return;
    fish = move(fish, picked, to);
    picked = null;
  }
  const card = (id: string) => index.get(id);
  const img = (id: string) => {
    const c = card(id);
    return c ? game.image(c).src : '';
  };
</script>

<dialog bind:this={dialog} onclose={onClose} class="fishbowl">
  <header>
    <h2>🐟 Goldfish</h2>
    <span class="muted small">
      {fish.turn ? `${config.turn} ${fish.turn}` : 'Setup'} · {fish.library.length} in deck · {fish.resources.length} resources
    </span>
    <span class="spacer"></span>
    <button onclick={() => { fish = start(deck, config); picked = null; }}>New hand</button>
    <button class="ghost" onclick={() => dialog?.close()} aria-label="Close">✕</button>
  </header>

  <div class="body">
    {#if config.note && fish.turn === 0}<p class="note small">{config.note}</p>{/if}

    {#if commandCards.length}
      <div class="command">
        {#each commandCards as c, i (c.id + i)}
          <img src={game.image(c).src} alt={game.label(c)} title={game.label(c)} />
        {/each}
      </div>
    {/if}

    <section>
      <div class="row-head">
        <h3>Hand <span class="num muted">{fish.hand.length}</span></h3>
        <div class="controls">
          {#if fish.turn === 0}
            <button onclick={() => (fish = mulligan(fish, config))} disabled={fish.mulligansLeft <= 0}>Mulligan ({fish.mulligansLeft} left)</button>
          {/if}
          <button class="primary" onclick={() => { fish = nextTurn(fish, config); picked = null; }} disabled={!ready}>
            {fish.turn === 0 ? `Start ${config.turn.toLowerCase()} 1` : `Next ${config.turn.toLowerCase()} (draw ${config.draw})`}
          </button>
        </div>
      </div>
      {#if fish.turn === 0 && needResources}
        <p class="prompt small">Tap a card, then <strong>Resource</strong>. Choose {needResources} more.</p>
      {:else if fish.resourcesLeft > 0 && fish.turn > 0}
        <p class="prompt small">You may resource {fish.resourcesLeft} card this {config.turn.toLowerCase()}.</p>
      {/if}
      <div class="cards hand">
        {#each fish.hand as id, i (id + ':' + i)}
          <button class="card" class:picked={picked === i} onclick={() => (picked = picked === i ? null : i)} title={card(id) ? game.label(card(id)!) : id}>
            <img src={img(id)} alt={card(id) ? game.label(card(id)!) : id} />
          </button>
        {/each}
      </div>
      {#if picked !== null}
        <div class="actions">
          <button class="primary" onclick={() => act('played')} disabled={fish.turn === 0}>Play</button>
          {#if config.resources}<button onclick={() => act('resources')} disabled={fish.resourcesLeft <= 0}>Resource</button>{/if}
          <button onclick={() => act('discard')}>Discard</button>
          <button class="ghost" onclick={() => (picked = null)}>Cancel</button>
        </div>
      {/if}
    </section>

    <div class="piles">
      <section>
        <h3>In play <span class="num muted">{fish.played.length}</span></h3>
        <div class="cards small-cards">
          {#each fish.played as id, i (id + ':' + i)}
            <button class="card" onclick={() => (fish = unplay(fish, 'played', i))} title="Tap to return to hand"><img src={img(id)} alt="" /></button>
          {/each}
        </div>
      </section>
      {#if config.resources}
        <section>
          <h3>Resources <span class="num muted">{fish.resources.length}</span></h3>
          <div class="cards small-cards">
            {#each fish.resources as id, i (id + ':' + i)}
              <button class="card" onclick={() => (fish = unplay(fish, 'resources', i))} title="Tap to return to hand"><img src={img(id)} alt="" /></button>
            {/each}
          </div>
        </section>
      {/if}
      <section>
        <h3>Discard <span class="num muted">{fish.discard.length}</span></h3>
        <div class="cards small-cards">
          {#each fish.discard as id, i (id + ':' + i)}
            <button class="card" onclick={() => (fish = unplay(fish, 'discard', i))} title="Tap to return to hand"><img src={img(id)} alt="" /></button>
          {/each}
        </div>
      </section>
    </div>

    <div class="bottom">
      <section class="odds">
        <h3>Odds of an early play</h3>
        <table>
          <thead>
            <tr><th>Cost</th><th>Opening hand</th><th>By {config.turn.toLowerCase()} 2</th><th>By {config.turn.toLowerCase()} 3</th></tr>
          </thead>
          <tbody>
            {#each odds as o (o.k)}
              <tr>
                <td>{o.k} or less <span class="muted small">({o.hits})</span></td>
                {#each o.p as p, i (i)}<td class="num">{pct(p)}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="muted small">Chance of holding at least one such card (before resourcing), counting {config.draw} draws per {config.turn.toLowerCase()}.</p>
      </section>
      <section class="log">
        <h3>Log</h3>
        <ol>
          {#each fish.log as line, i (i)}<li class="small">{line}</li>{/each}
        </ol>
      </section>
    </div>
  </div>
</dialog>

<style>
  .fishbowl {
    max-width: min(1100px, calc(100vw - 16px));
    width: 100%;
    height: calc(100dvh - 16px);
    max-height: none;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 0;
    background: var(--panel);
    z-index: 2;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
  }
  .spacer {
    flex: 1;
  }
  .body {
    padding: 12px 16px 24px;
    display: grid;
    gap: 16px;
  }
  .note,
  .prompt {
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--panel-2);
  }
  .prompt {
    margin-bottom: 8px;
    border-left: 3px solid var(--accent);
  }
  .command {
    display: flex;
    gap: 8px;
  }
  .command img {
    width: 150px;
    border-radius: 8px;
  }
  h3 {
    font-size: 0.95rem;
    margin: 0 0 8px;
  }
  .row-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .row-head h3 {
    margin: 0;
  }
  .controls {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .card {
    padding: 0;
    border: 0;
    background: none;
    border-radius: 8px;
    overflow: hidden;
    width: 130px;
    aspect-ratio: 63 / 88;
    outline: 3px solid transparent;
    transition: transform 0.1s;
  }
  .card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .card.picked {
    outline-color: var(--accent);
    transform: translateY(-6px);
  }
  .small-cards .card {
    width: 72px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .piles {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 14px;
  }
  .piles section,
  .bottom section {
    background: var(--panel-2);
    border-radius: 10px;
    padding: 10px 12px;
    min-height: 80px;
  }
  .bottom {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 14px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th {
    text-align: left;
    color: var(--muted);
    font-weight: 500;
    font-size: 0.8rem;
  }
  th,
  td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--line);
  }
  .odds p {
    margin: 8px 0 0;
  }
  .log ol {
    margin: 0;
    padding-left: 18px;
    max-height: 180px;
    overflow-y: auto;
  }
  @media (max-width: 760px) {
    .card {
      width: calc((100% - 16px) / 3);
    }
    .small-cards .card {
      width: 56px;
    }
    .piles,
    .bottom {
      grid-template-columns: 1fr;
    }
    .command img {
      width: 120px;
    }
  }
</style>
