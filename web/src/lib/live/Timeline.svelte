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

<footer class="h-16 border-t border-neutral-800 bg-neutral-950 flex items-center gap-4 px-4">
  <!-- play / pause -->
  <button
    type="button"
    onclick={() => stream.togglePlay()}
    disabled={!info}
    class="font-mono text-[11px] tracking-[0.15em] px-4 py-2 border disabled:opacity-30"
    class:border-cyan-400={stream.playing}
    class:text-cyan-400={stream.playing}
    class:bg-cyan-950={stream.playing}
    class:border-neutral-700={!stream.playing}
    class:text-neutral-300={!stream.playing}
  >
    {stream.playing ? '⏸ PAUSE' : '▶ PLAY'}
  </button>

  <!-- fps selector -->
  <div class="flex items-center gap-1">
    <span class="font-mono text-[9px] tracking-[0.15em] text-neutral-500 mr-2">RATE</span>
    {#each [1, 2, 4, 8] as r}
      <button
        type="button"
        onclick={() => stream.setFps(r)}
        class="font-mono text-[10px] px-2 py-1 border tabular-nums"
        class:border-cyan-400={stream.fps === r}
        class:text-cyan-400={stream.fps === r}
        class:bg-cyan-950={stream.fps === r}
        class:border-neutral-800={stream.fps !== r}
        class:text-neutral-500={stream.fps !== r}
      >
        {r}fps
      </button>
    {/each}
  </div>

  <!-- timeline scrubber -->
  <div class="flex-1 flex items-center gap-3">
    <span class="font-mono text-[10px] text-neutral-500 tabular-nums w-10 text-right">
      {((frame?.t_ms ?? 0) / 1000).toFixed(1)}s
    </span>
    <div
      role="slider"
      tabindex="0"
      aria-valuenow={progress * 100}
      aria-valuemin={0}
      aria-valuemax={100}
      onclick={onScrub}
      onkeydown={(e) => {
        if (!info) return
        if (e.key === 'ArrowLeft') stream.seek(Math.max(0, (frame?.frame_idx ?? 0) - 30))
        if (e.key === 'ArrowRight') stream.seek(Math.min(info.frame_count - 1, (frame?.frame_idx ?? 0) + 30))
      }}
      class="relative flex-1 h-2 bg-neutral-900 border border-neutral-800 cursor-pointer"
    >
      <div
        class="absolute top-0 left-0 bottom-0 bg-cyan-700/60"
        style:width="{progress * 100}%"
      ></div>
      <div
        class="absolute top-1/2 w-3 h-3 bg-cyan-400"
        style:left="{progress * 100}%"
        style:transform="translate(-50%, -50%)"
      ></div>
    </div>
    <span class="font-mono text-[10px] text-neutral-500 tabular-nums w-10">
      {(info?.duration_s ?? 0).toFixed(1)}s
    </span>
  </div>
</footer>
