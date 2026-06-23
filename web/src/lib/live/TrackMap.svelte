<script lang="ts">
  import { stream } from '../stores/stream.svelte'
  let frame = $derived(stream.frame)
  let trail = $derived(frame?.peak_trail ?? [])
  let current = $derived(trail.length > 0 ? trail[trail.length - 1] : null)
</script>

<div class="aspect-square w-full relative" style:background="var(--surface-2)" style:border="1px solid var(--line)">
  <!-- 4-tick gridlines, no decorative background-image -->
  <div class="absolute left-1/4 top-0 bottom-0 w-px" style:background="var(--line)"></div>
  <div class="absolute left-1/2 top-0 bottom-0 w-px" style:background="var(--line-strong)"></div>
  <div class="absolute left-3/4 top-0 bottom-0 w-px" style:background="var(--line)"></div>
  <div class="absolute top-1/4 left-0 right-0 h-px" style:background="var(--line)"></div>
  <div class="absolute top-1/2 left-0 right-0 h-px" style:background="var(--line-strong)"></div>
  <div class="absolute top-3/4 left-0 right-0 h-px" style:background="var(--line)"></div>

  {#if trail.length === 0}
    <div class="absolute inset-0 flex items-center justify-center text-[9px] text-dim tracking-wider">NO DATA</div>
  {:else}
    <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline
        points={trail.map(p => `${p.nx * 100},${p.ny * 100}`).join(' ')}
        fill="none" stroke="var(--accent)" stroke-width="0.5" stroke-opacity="0.55"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    {#each trail as p, i (p.frame_idx)}
      {@const isCurrent = i === trail.length - 1}
      <div
        class="absolute pointer-events-none"
        style:left="{p.nx * 100}%" style:top="{p.ny * 100}%"
        style:transform="translate(-50%, -50%)"
        style:width="{isCurrent ? 8 : 3}px"
        style:height="{isCurrent ? 8 : 3}px"
        style:background={isCurrent ? 'var(--accent)' : `rgba(245,158,11,${0.15 + (i / trail.length) * 0.5})`}
        style:box-shadow={isCurrent ? '0 0 8px var(--accent-glow)' : 'none'}
      ></div>
    {/each}

    {#if current}
      <div class="absolute top-1 left-1 text-[9px] tabular-nums" style:color="var(--accent)">
        {(current.nx * 100).toFixed(0)}·{(current.ny * 100).toFixed(0)}
      </div>
      <div class="absolute bottom-1 right-1 text-[9px] tabular-nums text-dim">
        N={trail.length}
      </div>
    {/if}
  {/if}
</div>
