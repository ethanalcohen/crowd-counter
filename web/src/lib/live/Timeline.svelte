<script lang="ts">
  import { stream } from '../stores/stream.svelte'
  let frame = $derived(stream.frame)
  let info = $derived(stream.info)
  let progress = $derived(frame && info ? frame.frame_idx / info.frame_count : 0)

  function onScrub(e: MouseEvent) {
    if (!info) return
    const target = e.currentTarget as HTMLDivElement
    const r = target.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    stream.seek(Math.floor(ratio * info.frame_count))
  }
</script>

<footer class="h-10 border-t flex items-center gap-3 px-3" style:border-color="var(--line)" style:background="var(--surface)">
  <button
    type="button"
    onclick={() => stream.togglePlay()}
    disabled={!info}
    class={stream.playing ? 'primary' : ''}
    style:min-width="64px"
  >
    {stream.playing ? 'PAUSE' : 'PLAY'}
  </button>

  <div class="flex border" style:border-color="var(--line)">
    {#each [1, 2, 3] as r}
      <button
        type="button"
        onclick={() => stream.setFps(r)}
        class:primary={stream.fps === r}
        style:border="0"
        style:padding="6px 8px"
      >
        {r}F
      </button>
    {/each}
  </div>

  <div class="flex-1 flex items-center gap-2">
    <span class="text-[10px] text-muted tabular-nums w-12 text-right">{((frame?.t_ms ?? 0) / 1000).toFixed(1)}s</span>
    <div
      role="slider"
      tabindex="0"
      aria-valuenow={progress * 100}
      aria-valuemin={0} aria-valuemax={100}
      onclick={onScrub}
      onkeydown={(e) => {
        if (!info) return
        if (e.key === 'ArrowLeft') stream.seek(Math.max(0, (frame?.frame_idx ?? 0) - 30))
        if (e.key === 'ArrowRight') stream.seek(Math.min(info.frame_count - 1, (frame?.frame_idx ?? 0) + 30))
      }}
      class="relative flex-1 h-1.5 cursor-pointer"
      style:background="var(--surface-3)"
      style:border="1px solid var(--line)"
    >
      <div class="absolute top-0 left-0 bottom-0" style:width="{progress * 100}%" style:background="var(--accent)"></div>
      <div class="absolute top-1/2 w-0.5 h-3 bg-white" style:left="{progress * 100}%" style:transform="translate(-50%, -50%)"></div>
    </div>
    <span class="text-[10px] text-muted tabular-nums w-12">{(info?.duration_s ?? 0).toFixed(1)}s</span>
  </div>
</footer>
