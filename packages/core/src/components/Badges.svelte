<script lang="ts">
  // A row of small tags (UniVersus symbols): round for normal, square for attuned.
  import type { Badge } from '../types';

  let { badges, size = 'small' }: { badges: Badge[]; size?: 'mini' | 'small' | 'large' } = $props();
</script>

{#if badges.length}
  <span class="badges {size}">
    {#each badges as b, i (i)}
      <span class="badge" class:square={b.square} style:--c={b.color} title={b.title} aria-label={b.title}>{b.text}</span>
    {/each}
  </span>
{/if}

<style>
  .badges {
    display: inline-flex;
    flex: none;
    gap: 3px;
    vertical-align: middle;
  }
  .badge {
    --c: var(--muted);
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 2px;
    border-radius: 999px;
    font-size: 0.68rem;
    line-height: 1;
    background: color-mix(in srgb, var(--c) 22%, var(--panel));
    border: 1.5px solid var(--c);
  }
  .badge.square {
    border-radius: 4px;
    border-width: 2px;
    box-shadow: inset 0 0 0 1px var(--panel);
  }
  .mini .badge {
    min-width: 15px;
    height: 15px;
    font-size: 0.58rem;
    border-width: 1px;
  }
  .large .badge {
    min-width: 28px;
    height: 28px;
    font-size: 0.95rem;
  }
</style>
