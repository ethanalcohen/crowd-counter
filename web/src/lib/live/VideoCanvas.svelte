<script lang="ts">
  import { stream } from '../stores/stream.svelte'

  let containerEl = $state<HTMLDivElement | null>(null)
  let showDetections = $state(true)
  let frame = $derived(stream.frame)
  let frameSrc = $derived(frame ? `data:image/jpeg;base64,${frame.frame_jpeg_b64}` : null)
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

  // screen <-> image coord helpers
  function imgToScreen(x: number, y: number) {
    if (!frame || rendered.w === 0) return { x: 0, y: 0 }
    return {
      x: rendered.ox + (x / frame.width) * rendered.w,
      y: rendered.oy + (y / frame.height) * rendered.h,
    }
  }
  function screenToImg(sx: number, sy: number) {
    if (!frame || rendered.w === 0) return null
    const ix = ((sx - rendered.ox) / rendered.w) * frame.width
    const iy = ((sy - rendered.oy) / rendered.h) * frame.height
    if (ix < 0 || iy < 0 || ix > frame.width || iy > frame.height) return null
    return { x: ix, y: iy }
  }

  function pxScale() {
    return frame && rendered.w > 0 ? rendered.w / frame.width : 1
  }

  function onCanvasClick(ev: MouseEvent) {
    if (!frame || !containerEl) return
    const rect = containerEl.getBoundingClientRect()
    const sx = ev.clientX - rect.left
    const sy = ev.clientY - rect.top
    const p = screenToImg(sx, sy)
    if (p) stream.selectTrack(p.x, p.y)
  }
</script>

<div
  bind:this={containerEl}
  class="relative w-full h-full overflow-hidden"
  style:background="#000"
  onclick={onCanvasClick}
  role="presentation"
>
  {#if !frame}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
      <div class="label text-[10px]">NO FEED</div>
      <div class="text-[10px] text-dim">SELECT A SOURCE</div>
    </div>
  {:else}
    <img
      src={frameSrc} alt="frame"
      class="absolute pointer-events-none"
      style:left="{rendered.ox}px" style:top="{rendered.oy}px"
      style:width="{rendered.w}px" style:height="{rendered.h}px"
    />

    {#if showDetections}
      <!-- per-person dots + id labels -->
      <svg
        class="absolute pointer-events-none"
        style:left="{rendered.ox}px" style:top="{rendered.oy}px"
        style:width="{rendered.w}px" style:height="{rendered.h}px"
        viewBox="0 0 {frame.width} {frame.height}"
        preserveAspectRatio="none"
      >
        {#each frame.detections as d (d.id)}
          {@const isSel = frame.selected?.id === d.id}
          <circle
            cx={d.cx} cy={d.cy}
            r={isSel ? 9 / pxScale() : 4 / pxScale()}
            fill="none"
            stroke={isSel ? 'var(--accent)' : 'rgba(245,158,11,0.55)'}
            stroke-width={isSel ? 2 / pxScale() : 1 / pxScale()}
          />
        {/each}
      </svg>
    {/if}

    {#if frame.cluster}
      <!-- dense-region halo -->
      {@const c = imgToScreen(frame.cluster.cx, frame.cluster.cy)}
      {@const r = frame.cluster.radius_px * pxScale()}
      <div
        class="absolute pointer-events-none rounded-full"
        style:left="{c.x - r}px" style:top="{c.y - r}px"
        style:width="{r * 2}px" style:height="{r * 2}px"
        style:border="1px dashed var(--accent)"
        style:background="radial-gradient(circle, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0) 70%)"
      ></div>
      <div
        class="absolute pointer-events-none text-[9px] tracking-wider"
        style:left="{c.x + r + 4}px" style:top="{c.y - 6}px"
        style:color="var(--accent)"
        style:text-shadow="0 0 4px rgba(0,0,0,0.9)"
      >
        DENSE · N={frame.cluster.member_count}
      </div>
    {/if}

    {#if frame.selected}
      <!-- selected track lock-on -->
      {@const s = imgToScreen(frame.selected.cx, frame.selected.cy)}
      <div
        class="absolute pointer-events-none text-[9px] tracking-wider"
        style:left="{s.x + 14}px" style:top="{s.y - 14}px"
        style:color="var(--accent)"
        style:text-shadow="0 0 4px rgba(0,0,0,0.9)"
      >
        TGT · ID {frame.selected.id}
      </div>
    {/if}

    <!-- HUD corner brackets -->
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

    <!-- controls strip -->
    <div class="absolute bottom-2 right-2 flex gap-2">
      {#if frame.selected}
        <button
          type="button"
          onclick={(e) => { e.stopPropagation(); stream.clearSelection() }}
          style:background="transparent"
          style:border-color="var(--line)"
          style:color="var(--text-muted)"
        >
          CLEAR · ID {frame.selected.id}
        </button>
      {/if}
      <button
        type="button"
        onclick={(e) => { e.stopPropagation(); showDetections = !showDetections }}
        style:background={showDetections ? 'var(--accent-dim)' : 'transparent'}
        style:border-color={showDetections ? 'var(--accent)' : 'var(--line)'}
        style:color={showDetections ? 'var(--accent)' : 'var(--text-muted)'}
      >
        DETS {showDetections ? 'ON' : 'OFF'}
      </button>
    </div>
  {/if}
</div>
