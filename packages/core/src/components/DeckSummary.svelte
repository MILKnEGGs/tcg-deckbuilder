<script lang="ts" generics="C extends Card">
  // Deck size, prices and rule issues. Shared by the Build and Deck views.
  import { sizeOf, totals } from '../deck';
  import type { Card, CardIndex, Deck, FormatDef, Issue } from '../types';
  import { money, plural } from '../util';

  let { index, deck, format, issues, sticky = true }: { index: CardIndex<C>; deck: Deck; format: FormatDef; issues: Issue[]; sticky?: boolean } = $props();

  const t = $derived(totals(deck, index));
  const maybe = $derived(totals(deck, index, [deck.considering ?? []]));
  const size = $derived(sizeOf(deck, format));
  const target = $derived(format.size.target);
</script>

<div class="summary" class:sticky>
  <div class="size" class:over={size > target} class:done={size === target || (!format.size.exact && size > target)}>
    <span class="big num">{size}<span class="of">/{target}</span></span>
    <span class="small muted">{format.size.exact ? 'cards' : 'card minimum'}</span>
  </div>
  <div class="money">
    <div><span class="muted small">Deck</span> <strong class="num">{money(t.total)}</strong></div>
    <div><span class="muted small">To finish</span> <strong class="num finish">{money(t.toFinish)}</strong></div>
    {#if maybe.cards}<div class="maybe small">Considering {plural(maybe.cards, 'card')} · <span class="num">{money(maybe.toFinish)}</span> to buy</div>{/if}
    {#if t.unpriced}<div class="muted small">{plural(t.unpriced, 'card')} without a price</div>{/if}
  </div>
</div>

{#if issues.length}
  <ul class="issues">
    {#each issues as i (i.message)}
      <li class={i.level}>{i.message}</li>
    {/each}
  </ul>
{:else if size}
  <p class="legal small">Deck is legal for {format.name}.</p>
{/if}

<style>
  .summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .summary.sticky {
    position: sticky;
    top: 0;
    z-index: 4;
  }
  .size {
    display: grid;
  }
  .big {
    font-size: 1.8rem;
    font-weight: 700;
    line-height: 1;
  }
  .of {
    font-size: 1rem;
    color: var(--muted);
    font-weight: 500;
  }
  .size.done .big {
    color: var(--ok);
  }
  .size.over .big {
    color: var(--warning);
  }
  .money {
    text-align: right;
    display: grid;
    gap: 2px;
  }
  .finish {
    color: var(--accent);
  }
  .maybe {
    color: var(--maybe);
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 10px 16px 0;
    display: grid;
    gap: 6px;
  }
  .issues li {
    padding: 7px 10px;
    border-radius: 8px;
    font-size: 0.88rem;
    border-left: 3px solid;
  }
  .issues .error {
    background: var(--error-bg);
    border-color: var(--error);
  }
  .issues .warning {
    background: var(--warning-bg);
    border-color: var(--warning);
  }
  .legal {
    color: var(--ok);
    margin: 10px 16px 0;
  }
  @media (max-width: 860px) {
    .summary.sticky {
      top: 41px;
    }
  }
</style>
