<script lang="ts">
  import { stream } from '../stores/stream.svelte'
  import TrackMap from './TrackMap.svelte'

  let frame = $derived(stream.frame)
  let info = $derived(stream.info)
  let inferenceFps = $derived(frame ? 1000 / Math.max(frame.inference.latency_ms, 1) : 0)
</script>

<aside class="h-full flex flex-col border-l border-neutral-800 bg-neutral-950 w-80">
  <header class="px-3 py-2 border-b border-neutral-800 font-mono text-[10px] tracking-[0.2em] text-neutral-500">
    TRACK
  </header>

  <!-- track map at top -->
  <div class="p-3 border-b border-neutral-800">
    <TrackMap />
  </div>

  <!-- count, big -->
  <div class="px-3 py-3 border-b border-neutral-800">
    <div class="font-mono text-[10px] tracking-[0.2em] text-neutral-500">COUNT</div>
    <div class="font-mono text-cyan-400 text-5xl tabular-nums leading-none mt-2">
      {frame?.inference.count.toString().padStart(3, '0') ?? '---'}
    </div>
  </div>

  <!-- source block -->
  <div class="px-3 py-2 border-b border-neutral-800">
    <div class="font-mono text-[10px] tracking-[0.2em] text-neutral-500">SOURCE</div>
    {#if info}
      <div class="font-mono text-[12px] text-cyan-400 mt-1 truncate">{info.name}</div>
      <div class="font-mono text-[10px] text-neutral-500 mt-0.5">
        {info.width}×{info.height} · {info.fps.toFixed(0)} FPS · {info.duration_s.toFixed(1)}s
      </div>
    {:else}
      <div class="font-mono text-[12px] text-neutral-600 mt-1">— none —</div>
    {/if}
  </div>

  <!-- per-frame data -->
  <div class="px-3 py-2 border-b border-neutral-800 space-y-2 font-mono text-[10px]">
    <div class="flex justify-between">
      <span class="text-neutral-500">FRAME</span>
      <span class="text-cyan-400 tabular-nums">
        {frame?.frame_idx.toString().padStart(5, '0') ?? '00000'} / {info?.frame_count ?? 0}
      </span>
    </div>
    <div class="flex justify-between">
      <span class="text-neutral-500">TIME</span>
      <span class="text-cyan-400 tabular-nums">
        {((frame?.t_ms ?? 0) / 1000).toFixed(2)}s
      </span>
    </div>
    <div class="flex justify-between">
      <span class="text-neutral-500">PEAK · X,Y</span>
      <span class="text-cyan-400 tabular-nums">
        {frame ? `${frame.inference.peak_xy[0]},${frame.inference.peak_xy[1]}` : '—'}
      </span>
    </div>
  </div>

  <!-- inference vs display rates — honest -->
  <div class="px-3 py-2 border-b border-neutral-800 space-y-2 font-mono text-[10px]">
    <div class="flex justify-between">
      <span class="text-neutral-500">INFERENCE</span>
      <span class="text-amber-400 tabular-nums">
        {frame?.inference.latency_ms.toFixed(0) ?? '—'}ms · {inferenceFps.toFixed(1)} fps cap
      </span>
    </div>
    <div class="flex justify-between">
      <span class="text-neutral-500">STREAM</span>
      <span class="text-cyan-400 tabular-nums">
        {stream.fpsActual.toFixed(1)} fps actual
      </span>
    </div>
  </div>

  <div class="flex-1"></div>

  <footer class="px-3 py-2 border-t border-neutral-800 font-mono text-[9px] text-neutral-600 leading-relaxed">
    P2PNET · MPS · 21M PARAMS<br/>
    REAL-TIME &gt;30FPS REQUIRES JETSON + TENSORRT
  </footer>
</aside>
