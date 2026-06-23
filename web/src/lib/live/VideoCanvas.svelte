<script lang="ts">
  import { stream } from '../stores/stream.svelte'

  let containerEl = $state<HTMLDivElement | null>(null)
  let imgEl = $state<HTMLImageElement | null>(null)
  let heatEl = $state<HTMLImageElement | null>(null)

  // current frame as derived data
  let frame = $derived(stream.frame)
  let showHeatmap = $state(true)

  // image src updates as the base64 changes; let the browser cache via data: URIs
  let frameSrc = $derived(frame ? `data:image/jpeg;base64,${frame.frame_jpeg_b64}` : null)
  let heatSrc = $derived(frame ? `data:image/jpeg;base64,${frame.heatmap_jpeg_b64}` : null)

  let peakPx = $derived<[number, number] | null>(frame ? frame.inference.peak_xy as [number, number] : null)

  // compute rendered geometry for peak marker positioning
  let rendered = $state({ w: 0, h: 0, ox: 0, oy: 0 })

  $effect(() => {
    if (!frame || !containerEl) return
    const update = () => {
      if (!containerEl || !frame) return
      const c = containerEl.getBoundingClientRect()
      const aspect = frame.width / frame.height
      let w = c.width
      let h = c.width / aspect
      if (h > c.height) {
        h = c.height
        w = c.height * aspect
      }
      rendered = { w, h, ox: (c.width - w) / 2, oy: (c.height - h) / 2 }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(containerEl)
    return () => ro.disconnect()
  })

  let peakOnScreen = $derived(
    frame && peakPx && rendered.w > 0
      ? {
          x: rendered.ox + (peakPx[0] / frame.width) * rendered.w,
          y: rendered.oy + (peakPx[1] / frame.height) * rendered.h,
        }
      : null,
  )
</script>

<div bind:this={containerEl} class="relative w-full h-full overflow-hidden bg-black">
  {#if !frame}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-neutral-600">
      <div class="font-mono text-[11px] tracking-[0.25em]">NO FEED</div>
      <div class="font-mono text-[10px]">
        → SELECT A SOURCE FROM THE LEFT
      </div>
    </div>
  {:else}
    <img
      bind:this={imgEl}
      src={frameSrc}
      alt="frame"
      class="absolute"
      style:left="{rendered.ox}px"
      style:top="{rendered.oy}px"
      style:width="{rendered.w}px"
      style:height="{rendered.h}px"
    />
    {#if showHeatmap}
      <img
        bind:this={heatEl}
        src={heatSrc}
        alt="heatmap"
        class="absolute pointer-events-none"
        style:left="{rendered.ox}px"
        style:top="{rendered.oy}px"
        style:width="{rendered.w}px"
        style:height="{rendered.h}px"
        style:opacity="0.55"
        style:mix-blend-mode="screen"
      />
    {/if}

    {#if peakOnScreen && peakPx && (peakPx[0] !== 0 || peakPx[1] !== 0)}
      <div
        class="absolute pointer-events-none"
        style:left="{peakOnScreen.x}px"
        style:top="{peakOnScreen.y}px"
        style:transform="translate(-50%, -50%)"
      >
        <svg width="80" height="80" style="overflow: visible">
          <circle cx="40" cy="40" r="22" fill="none" stroke="#22d3ee" stroke-width="1.5" />
          <circle cx="40" cy="40" r="3" fill="#22d3ee" />
          <line x1="40" y1="2" x2="40" y2="22" stroke="#22d3ee" stroke-width="1" />
          <line x1="40" y1="58" x2="40" y2="78" stroke="#22d3ee" stroke-width="1" />
          <line x1="2" y1="40" x2="22" y2="40" stroke="#22d3ee" stroke-width="1" />
          <line x1="58" y1="40" x2="78" y2="40" stroke="#22d3ee" stroke-width="1" />
        </svg>
        <div
          class="font-mono text-[10px] absolute whitespace-nowrap"
          style:left="88px"
          style:top="32px"
          style:color="#22d3ee"
          style:text-shadow="0 0 4px rgba(0,0,0,0.9)"
        >
          PEAK · {peakPx[0]},{peakPx[1]}
        </div>
      </div>
    {/if}

    <!-- heatmap toggle -->
    <button
      type="button"
      onclick={() => showHeatmap = !showHeatmap}
      class="absolute bottom-3 right-3 font-mono text-[10px] tracking-[0.15em] px-3 py-1.5 border bg-neutral-950/70"
      class:border-cyan-400={showHeatmap}
      class:text-cyan-400={showHeatmap}
      class:border-neutral-700={!showHeatmap}
      class:text-neutral-500={!showHeatmap}
    >
      {showHeatmap ? '◉ HEATMAP' : '○ HEATMAP'}
    </button>
  {/if}
</div>
