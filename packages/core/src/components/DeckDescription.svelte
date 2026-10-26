<script lang="ts">
  // The deck's description: what it does and how to play it. Exported with the list.
  import type { Deck } from '../types';

  let { deck, changed }: { deck: Deck; changed: () => void } = $props();
</script>

<section class="description">
  <h3>Description</h3>
  <textarea bind:value={deck.description} oninput={changed} rows="4" placeholder="Full description of the deck and how to play" aria-label="Deck description"></textarea>
</section>

<style>
  .description {
    padding: 8px 16px 12px;
  }
  h3 {
    font-size: 0.95rem;
    margin: 8px 0 6px;
  }
  textarea {
    display: block;
    width: 100%;
    min-height: 5.5em;
    resize: vertical;
    line-height: 1.45;
    /* Grows with the text where the browser can. */
    field-sizing: content;
    max-height: 60vh;
  }
</style>
