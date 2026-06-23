<script lang="ts">
  import { stream } from '../stores/stream.svelte'

  let frame = $derived(stream.frame)
  let info = $derived(stream.info)
</script>

{#if info}
  <!-- top-left: source / frame / file -->
  <div class="absolute top-3 left-3 px-3 py-2 border border-neutral-700 bg-neutral-950/85 font-mono text-[10px] leading-relaxed">
    <div class="text-neutral-500">SOURCE</div>
    <div class="text-cyan-400 mt-0.5">{info.name.toUpperCase()}</div>

    <div class="text-neutral-500 mt-2">FRAME</div>
    <div class="text-cyan-400 mt-0.5 tabular-nums">
      {frame?.frame_idx.toString().padStart(5, '0') ?? '00000'} / {info.frame_count}
    </div>

    <div class="text-neutral-500 mt-2">TIME</div>
    <div class="text-cyan-400 mt-0.5 tabular-nums">
      {(frame?.t_ms ?? 0 / 1000).toFixed(2)}s / {info.duration_s.toFixed(1)}s
    </div>
  </div>
{/if}

{#if frame}
  <!-- top-right: count + peak + latency + fps -->
  <div class="absolute top-3 right-3 px-3 py-2 border border-neutral-700 bg-neutral-950/85 font-mono text-[10px] leading-relaxed text-right min-w-[140px]">
    <div class="text-neutral-500">COUNT</div>
    <div class="text-cyan-400 text-3xl mt-0.5 tabular-nums">
      {frame.inference.count.toString().padStart(3, '0')}
    </div>

    <div class="text-neutral-500 mt-2">PEAK · X,Y</div>
    <div class="text-cyan-400 mt-0.5 tabular-nums">
      {frame.inference.peak_xy[0]},{frame.inference.peak_xy[1]}
    </div>

    <div class="text-neutral-500 mt-2">LATENCY · FPS</div>
    <div class="text-cyan-400 mt-0.5 tabular-nums">
      {frame.inference.latency_ms.toFixed(0)}ms · {stream.fpsActual.toFixed(1)}
    </div>
  </div>
{/if}
