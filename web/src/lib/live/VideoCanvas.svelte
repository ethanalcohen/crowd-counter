<script lang="ts">
  import { stream } from '../stores/stream.svelte'

  let containerEl = $state<HTMLDivElement | null>(null)
  let showHeatmap = $state(true)
  let frame = $derived(stream.frame)
  let frameSrc = $derived(frame ? `data:image/jpeg;base64,${frame.frame_jpeg_b64}` : null)
  let heatSrc = $derived(frame ? `data:image/jpeg;base64,${frame.heatmap_jpeg_b64}` : null)
  let peakPx = $derived<[number, number] | null>(frame ? frame.inference.peak_xy as [number, number] : null)
  let rendered = $state({ w: 0, h: 0, ox: 0, oy: 0 })

  $effect(() => {
    if (!frame || !containerEl) return
    const update = () => {
      if (!containerEl || !frame) return
      const c = containerEl.getBoundingClientRect()
      const aspect = frame.width / frame.height
      let w = c.width
      let h = c.width / aspect
      if (h > c.height) { h = c.height; w = c.height * aspect }
      rendered = { w, h, ox: (c.width - w) / 2, oy: (c.height - h) / 2 }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(containerEl)
    return () => ro.disconnect()
  })

  let peakOnScreen = $derived(
    frame && peakPx && rendered.w > 0
      ? { x: rendered.ox + (peakPx[0] / frame.width) * rendered.w,
          y: rendered.oy + (peakPx[1] / frame.height) * rendered.h }
      : null,
  )
</script>

<div bind:this={containerEl} class="relative w-full h-full overflow-hidden" style:background="#000">
  {#if !frame}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
      <div class="label text-[10px]">NO FEED</div>
      <div class="text-[10px] text-dim">SELECT A SOURCE</div>
    </div>
  {:else}
    <img
      src={frameSrc} alt="frame"
      class="absolute"
      style:left="{rendered.ox}px" style:top="{rendered.oy}px"
      style:width="{rendered.w}px" style:height="{rendered.h}px"
    />
    {#if showHeatmap}
      <img
        src={heatSrc} alt="heatmap"
        class="absolute pointer-events-none"
        style:left="{rendered.ox}px" style:top="{rendered.oy}px"
        style:width="{rendered.w}px" style:height="{rendered.h}px"
        style:opacity="0.55"
        style:mix-blend-mode="screen"
      />
    {/if}

    <!-- HUD corner brackets inside the rendered image -->
    <div
      class="absolute pointer-events-none"
      style:left="{rendered.ox}px" style:top="{rendered.oy}px"
      style:width="{rendered.w}px" style:height="{rendered.h}px"
    >
      <div class="absolute" style:top="0" style:left="0" style:width="16px" style:height="1px" style:background="var(--accent)"></div>
      <div class="absolute" style:top="0" style:left="0" style:width="1px" style:height="16px" style:background="var(--accent)"></div>
      <div class="absolute" style:top="0" style:right="0" style:width="16px" style:height="1px" style:background="var(--accent)"></div>
      <div class="absolute" style:top="0" style:right="0" style:width="1px" style:height="16px" style:background="var(--accent)"></div>
      <div class="absolute" style:bottom="0" style:left="0" style:width="16px" style:height="1px" style:background="var(--accent)"></div>
      <div class="absolute" style:bottom="0" style:left="0" style:width="1px" style:height="16px" style:background="var(--accent)"></div>
      <div class="absolute" style:bottom="0" style:right="0" style:width="16px" style:height="1px" style:background="var(--accent)"></div>
      <div class="absolute" style:bottom="0" style:right="0" style:width="1px" style:height="16px" style:background="var(--accent)"></div>
    </div>

    {#if peakOnScreen && peakPx && (peakPx[0] !== 0 || peakPx[1] !== 0)}
      <div
        class="absolute pointer-events-none"
        style:left="{peakOnScreen.x}px" style:top="{peakOnScreen.y}px"
        style:transform="translate(-50%, -50%)"
      >
        <svg width="60" height="60" style="overflow: visible">
          <line x1="30" y1="6" x2="30" y2="20" stroke="var(--accent)" stroke-width="1"/>
          <line x1="30" y1="40" x2="30" y2="54" stroke="var(--accent)" stroke-width="1"/>
          <line x1="6" y1="30" x2="20" y2="30" stroke="var(--accent)" stroke-width="1"/>
          <line x1="40" y1="30" x2="54" y2="30" stroke="var(--accent)" stroke-width="1"/>
          <rect x="28" y="28" width="4" height="4" fill="var(--accent)"/>
        </svg>
        <div
          class="absolute text-[9px] whitespace-nowrap tracking-wider"
          style:left="42px" style:top="28px"
          style:color="var(--accent)"
          style:text-shadow="0 0 4px rgba(0,0,0,0.9)"
        >
          TGT · {peakPx[0]},{peakPx[1]}
        </div>
      </div>
    {/if}

    <!-- bottom-right: heatmap toggle -->
    <button
      type="button"
      onclick={() => showHeatmap = !showHeatmap}
      class="absolute bottom-2 right-2"
      style:background={showHeatmap ? 'var(--accent-dim)' : 'transparent'}
      style:border-color={showHeatmap ? 'var(--accent)' : 'var(--line)'}
      style:color={showHeatmap ? 'var(--accent)' : 'var(--text-muted)'}
    >
      HEATMAP {showHeatmap ? 'ON' : 'OFF'}
    </button>
  {/if}
</div>
