<script lang="ts">
  import { stream } from '../stores/stream.svelte'

  let frame = $derived(stream.frame)
  let trail = $derived(frame?.peak_trail ?? [])
  let current = $derived(trail.length > 0 ? trail[trail.length - 1] : null)
</script>

<div class="aspect-square w-full relative border border-neutral-800 bg-neutral-950" style="background-image: linear-gradient(rgba(34,211,238,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.06) 1px, transparent 1px); background-size: 12.5% 12.5%;">
  <!-- crosshair axes -->
  <div class="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-500/20 pointer-events-none"></div>
  <div class="absolute top-1/2 left-0 right-0 h-px bg-cyan-500/20 pointer-events-none"></div>

  {#if trail.length === 0}
    <div class="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-neutral-600">
      AWAITING DATA
    </div>
  {:else}
    <!-- trail polyline -->
    <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline
        points={trail.map(p => `${p.nx * 100},${p.ny * 100}`).join(' ')}
        fill="none"
        stroke="#22d3ee"
        stroke-width="0.6"
        stroke-opacity="0.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <!-- trail dots, age-faded -->
    {#each trail as p, i (p.frame_idx)}
      {@const age = (trail.length - 1 - i) / Math.max(trail.length, 1)}
      {@const isCurrent = i === trail.length - 1}
      <div
        class="absolute rounded-full pointer-events-none"
        style:left="{p.nx * 100}%"
        style:top="{p.ny * 100}%"
        style:transform="translate(-50%, -50%)"
        style:width="{isCurrent ? 12 : 4 + (1 - age) * 4}px"
        style:height="{isCurrent ? 12 : 4 + (1 - age) * 4}px"
        style:background={isCurrent ? '#22d3ee' : `rgba(34, 211, 238, ${0.15 + (1 - age) * 0.5})`}
        style:box-shadow={isCurrent ? '0 0 12px #22d3ee' : 'none'}
        style:border={isCurrent ? '2px solid white' : 'none'}
      ></div>
    {/each}

    {#if current}
      <div class="absolute top-1 left-1 font-mono text-[9px] text-cyan-400 tabular-nums">
        {(current.nx * 100).toFixed(1)}, {(current.ny * 100).toFixed(1)} ·N
      </div>
      <div class="absolute bottom-1 right-1 font-mono text-[9px] text-neutral-500 tabular-nums">
        {trail.length} pts
      </div>
    {/if}
  {/if}
</div>
