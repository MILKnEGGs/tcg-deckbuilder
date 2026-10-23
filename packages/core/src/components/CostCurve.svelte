<script lang="ts" generics="C extends Card">
  // Bar chart of the main deck's costs, 0 to 8+.
  import type { Card, CardIndex, Deck, GameDef } from '../types';

  let { game, index, deck }: { game: GameDef<C>; index: CardIndex<C>; deck: Deck } = $props();

  const curve = $derived.by(() => {
    const counts = new Map<number, number>();
    for (const e of deck.zones.main ?? []) {
      const c = index.get(e.id);
      const cost = c ? game.cost(c) : null;
      if (cost == null) continue;
      const k = Math.min(cost, 8);
      counts.set(k, (counts.get(k) ?? 0) + e.qty);
    }
    const max = Math.max(1, ...counts.values());
    return Array.from({ length: 9 }, (_, i) => ({ label: i === 8 ? '8+' : String(i), n: counts.get(i) ?? 0, h: (counts.get(i) ?? 0) / max }));
  });
</script>

<div class="curve" role="img" aria-label="Cost curve: {curve.map((b) => `${b.n} at ${b.label}`).join(', ')}">
  {#each curve as b (b.label)}
    <div class="bar">
      <span class="n num small">{b.n || ''}</span>
      <span class="fill" style:height="{Math.round(b.h * 64)}px"></span>
      <span class="small muted">{b.label}</span>
    </div>
  {/each}
</div>

<style>
  .curve {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 100px;
  }
  .bar {
    flex: 1;
    display: grid;
    justify-items: center;
    align-content: end;
    gap: 2px;
  }
  .fill {
    width: 100%;
    background: var(--accent);
    border-radius: 4px 4px 0 0;
    min-height: 1px;
    opacity: 0.85;
  }
</style>
