<script lang="ts">
  import { stream } from '../stores/stream.svelte'

  let frame = $derived(stream.frame)

  // top-K most confident points
  let top = $derived(
    frame
      ? frame.inference.points
          .slice()
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 25)
      : [],
  )
</script>

<aside class="h-full flex flex-col border-l border-neutral-800 bg-neutral-950 w-72">
  <header class="px-3 py-2 border-b border-neutral-800 font-mono text-[10px] tracking-[0.2em] text-neutral-500">
    DETECTIONS
  </header>

  {#if !frame}
    <div class="p-3 font-mono text-[10px] text-neutral-600">awaiting feed…</div>
  {:else}
    <div class="px-3 py-2 border-b border-neutral-900 grid grid-cols-3 gap-2 font-mono text-[10px]">
      <div>
        <div class="text-neutral-500">TOTAL</div>
        <div class="text-cyan-400 text-base mt-0.5 tabular-nums">{frame.inference.count}</div>
      </div>
      <div>
        <div class="text-neutral-500">SHOWN</div>
        <div class="text-cyan-400 text-base mt-0.5 tabular-nums">{top.length}</div>
      </div>
      <div>
        <div class="text-neutral-500">FRAME</div>
        <div class="text-cyan-400 text-base mt-0.5 tabular-nums">{frame.frame_idx}</div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div class="px-3 py-1.5 grid grid-cols-[20px_1fr_1fr_50px] gap-2 border-b border-neutral-900 font-mono text-[9px] tracking-[0.1em] text-neutral-600">
        <span>#</span>
        <span>X</span>
        <span>Y</span>
        <span class="text-right">CONF</span>
      </div>
      {#each top as p, i (i)}
        <div class="px-3 py-1 grid grid-cols-[20px_1fr_1fr_50px] gap-2 border-b border-neutral-950 font-mono text-[10px] tabular-nums hover:bg-neutral-900">
          <span class="text-neutral-600">{(i + 1).toString().padStart(2, '0')}</span>
          <span class="text-neutral-300">{p.x.toFixed(0)}</span>
          <span class="text-neutral-300">{p.y.toFixed(0)}</span>
          <span class="text-right" class:text-cyan-400={p.confidence > 0.7} class:text-amber-400={p.confidence <= 0.7}>
            {p.confidence.toFixed(2)}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</aside>
