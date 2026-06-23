<script lang="ts">
  import { stream } from '../stores/stream.svelte'
  import TrackMap from './TrackMap.svelte'

  let frame = $derived(stream.frame)
  let info = $derived(stream.info)
  let pose = $derived(frame?.pose ?? null)
  let world = $derived(frame?.peak_world ?? null)
  let inferenceFps = $derived(frame ? 1000 / Math.max(frame.inference.latency_ms, 1) : 0)

  const poseSourceColor: Record<string, string> = {
    drone: '#22d3ee',
    estimated: '#fbbf24',
    manual: '#a78bfa',
    none: '#737373',
  }
</script>

<aside class="h-full flex flex-col border-l border-neutral-800 bg-neutral-950 w-80 overflow-y-auto">
  <header class="px-3 py-2 border-b border-neutral-800 font-mono text-[10px] tracking-[0.2em] text-neutral-500 sticky top-0 bg-neutral-950 z-10">
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

  <!-- WORLD block -->
  <div class="px-3 py-3 border-b border-neutral-800">
    <div class="flex justify-between items-baseline">
      <span class="font-mono text-[10px] tracking-[0.2em] text-neutral-500">WORLD · GROUND PROJECTION</span>
      {#if pose}
        <span
          class="font-mono text-[9px] tracking-[0.1em] px-1.5 py-0.5 border"
          style:color={poseSourceColor[pose.source]}
          style:border-color={poseSourceColor[pose.source]}
        >
          {pose.source.toUpperCase()}
        </span>
      {/if}
    </div>

    {#if world}
      <div class="space-y-1 mt-2 font-mono text-[11px]">
        <div class="flex justify-between">
          <span class="text-neutral-500">X · Y (m)</span>
          <span class="text-cyan-400 tabular-nums">{world.x_m.toFixed(1)}, {world.y_m.toFixed(1)}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-neutral-500">RANGE</span>
          <span class="text-cyan-400 tabular-nums">{world.range_m.toFixed(1)} m ±{world.uncertainty_m.toFixed(1)}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-neutral-500">BEARING</span>
          <span class="text-cyan-400 tabular-nums">{world.bearing_deg.toFixed(0)}°</span>
        </div>
        {#if world.lat !== null && world.lon !== null}
          <div class="flex justify-between">
            <span class="text-neutral-500">LAT · LON</span>
            <span class="text-cyan-400 tabular-nums">{world.lat.toFixed(5)}, {world.lon.toFixed(5)}</span>
          </div>
        {/if}
      </div>
    {:else}
      <div class="mt-2 font-mono text-[10px] text-neutral-600 italic">
        {pose ? 'ray misses ground plane' : 'awaiting pose…'}
      </div>
    {/if}
  </div>

  <!-- POSE block + altitude control -->
  <div class="px-3 py-3 border-b border-neutral-800">
    <div class="font-mono text-[10px] tracking-[0.2em] text-neutral-500">POSE</div>

    {#if pose}
      <div class="space-y-1 mt-2 font-mono text-[11px]">
        <div class="flex justify-between">
          <span class="text-neutral-500">PITCH</span>
          <span class="text-cyan-400 tabular-nums">{pose.pitch_deg.toFixed(1)}°</span>
        </div>
        <div class="flex justify-between">
          <span class="text-neutral-500">ROLL</span>
          <span class="text-cyan-400 tabular-nums">{pose.roll_deg.toFixed(1)}°</span>
        </div>
        <div class="flex justify-between">
          <span class="text-neutral-500">VFOV</span>
          <span class="text-cyan-400 tabular-nums">{pose.vfov_deg?.toFixed(1) ?? '—'}°</span>
        </div>
        <div class="flex justify-between">
          <span class="text-neutral-500">CONF</span>
          <span class="text-cyan-400 tabular-nums">{(pose.confidence * 100).toFixed(0)}%</span>
        </div>
      </div>
    {:else}
      <div class="mt-2 font-mono text-[10px] text-neutral-600 italic">awaiting estimate…</div>
    {/if}

    <div class="mt-3">
      <div class="flex justify-between font-mono text-[10px] mb-1.5">
        <span class="text-neutral-500">ALTITUDE AGL</span>
        <span class="text-cyan-400 tabular-nums">{stream.altitude} m</span>
      </div>
      <input
        type="range" min={1} max={200} step={1}
        value={stream.altitude}
        oninput={(e) => stream.setAltitude(parseInt((e.target as HTMLInputElement).value))}
        class="w-full accent-cyan-400"
      />
    </div>

    <button
      type="button"
      onclick={() => stream.reestimatePose()}
      class="w-full mt-3 font-mono text-[10px] tracking-[0.15em] px-3 py-1.5 border border-neutral-700 text-neutral-300 hover:border-cyan-400 hover:text-cyan-400"
    >
      ↻ RE-ESTIMATE POSE
    </button>
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
      <span class="text-neutral-500">PEAK · PX</span>
      <span class="text-cyan-400 tabular-nums">
        {frame ? `${frame.inference.peak_xy[0]},${frame.inference.peak_xy[1]}` : '—'}
      </span>
    </div>
    <div class="flex justify-between">
      <span class="text-neutral-500">INFERENCE</span>
      <span class="text-amber-400 tabular-nums">
        {frame?.inference.latency_ms.toFixed(0) ?? '—'}ms · {inferenceFps.toFixed(1)} fps cap
      </span>
    </div>
    <div class="flex justify-between">
      <span class="text-neutral-500">STREAM</span>
      <span class="text-cyan-400 tabular-nums">{stream.fpsActual.toFixed(1)} fps</span>
    </div>
  </div>

  <div class="flex-1"></div>

  <footer class="px-3 py-2 border-t border-neutral-800 font-mono text-[9px] text-neutral-600 leading-relaxed">
    P2PNET · MPS · 21M PARAMS<br/>
    POSE · PERSPECTIVEFIELDS-PARAMNET<br/>
    REAL-TIME &gt;30FPS REQUIRES JETSON + TENSORRT
  </footer>
</aside>
