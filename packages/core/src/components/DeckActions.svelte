<script lang="ts" generics="C extends Card">
  // Buy & share: TCGplayer Mass Entry, owned shortcuts, and decklist export.
  import { massEntry, setAllOwned, textList } from '../deck';
  import type { Card, CardIndex, Deck, FormatDef, GameDef } from '../types';
  import { plural } from '../util';

  let {
    game,
    index,
    deck,
    format,
    changed,
    say,
  }: { game: GameDef<C>; index: CardIndex<C>; deck: Deck; format: FormatDef; changed: () => void; say: (msg: string) => void } = $props();

  const buy = $derived(massEntry(game, deck, index));
  const buyCount = $derived(buy.lines.reduce((n, l) => n + parseInt(l, 10), 0));
  const buyMaybe = $derived(deck.considering?.length ? massEntry(game, { ...deck, zones: { considering: deck.considering } }, index) : null);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      say(`${what} copied`);
    } catch {
      prompt(`Copy the ${what.toLowerCase()}:`, text);
    }
  }

  function allOwned(v: boolean) {
    setAllOwned(deck, v);
    changed();
  }
</script>

<section class="actions">
  <h3>Buy & share</h3>
  {#if buy.url}
    <a class="buy" href={buy.url} target="_blank" rel="noopener">Buy {plural(buyCount, 'missing card')} on TCGplayer ↗</a>
    <p class="muted small">Opens TCGplayer Mass Entry with your list filled in. Check it, then Add to Cart.</p>
  {:else}
    <p class="muted small">{buy.unlisted.length ? '' : 'You own everything in this deck.'}</p>
  {/if}
  {#if buy.unlisted.length}
    <p class="warn small">Not on TCGplayer, so not in the list: {buy.unlisted.join(', ')}</p>
  {/if}
  {#if buyMaybe?.url}
    <a class="buy maybe" href={buyMaybe.url} target="_blank" rel="noopener">Buy considered cards ({buyMaybe.lines.length}) ↗</a>
  {/if}
  <div class="row">
    <button onclick={() => allOwned(true)}>Mark all owned</button>
    <button onclick={() => allOwned(false)}>Mark none owned</button>
  </div>
  <div class="row">
    <button onclick={() => copy(game.exportDeck(deck, index), 'Decklist')}>{game.exportLabel}</button>
    <button onclick={() => copy(textList(game, deck, index, format), 'Text list')}>Copy text list</button>
  </div>
  {#if buy.lines.length}
    <button class="ghost small" onclick={() => copy(buy.lines.join('\n'), 'Shopping list')}>Copy shopping list (Mass Entry format)</button>
  {/if}
</section>

<style>
  .actions {
    display: grid;
    gap: 8px;
    padding: 8px 16px 32px;
  }
  h3 {
    font-size: 0.95rem;
    margin: 8px 0 0;
  }
  p {
    margin: 0;
  }
  .buy {
    display: block;
    text-align: center;
    padding: 9px 12px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
    text-decoration: none;
  }
  .buy.maybe {
    background: var(--maybe);
    color: var(--maybe-ink);
  }
  .warn {
    color: var(--warning);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .row button {
    flex: 1;
  }
</style>
