<script lang="ts">
  import { stream } from '../stores/stream.svelte'
  import TrackMap from './TrackMap.svelte'

  let frame = $derived(stream.frame)
  let info = $derived(stream.info)
  let pose = $derived(frame?.pose ?? null)
  let worldCentroid = $derived(frame?.world_centroid ?? null)
  let worldSelected = $derived(frame?.world_selected ?? null)
  let selected = $derived(frame?.selected ?? null)
  let inferenceFps = $derived(frame ? 1000 / Math.max(frame.latency_ms, 1) : 0)
</script>

<aside class="h-full flex flex-col border-l w-80 overflow-y-auto" style:border-color="var(--line)" style:background="var(--surface)">

  <!-- TRACK section: map + count -->
  <header class="px-3 py-2 border-b label sticky top-0 z-10" style:border-color="var(--line)" style:background="var(--surface-2)">
    DENSE REGION TRAIL
  </header>

  <div class="px-3 py-3 border-b" style:border-color="var(--line)">
    <TrackMap />
  </div>

  <div class="px-3 py-2 border-b flex items-baseline justify-between" style:border-color="var(--line)">
    <div class="label">COUNT</div>
    <div class="text-[22px] leading-none tabular-nums" style:color="var(--accent)">
      {frame?.count.toString().padStart(3, '0') ?? '---'}
    </div>
  </div>

  <!-- SELECTED TRACK section -->
  <header class="px-3 py-2 border-b label flex justify-between items-center" style:border-color="var(--line)" style:background="var(--surface-2)">
    <span>SELECTED TRACK</span>
    {#if selected}
      <button
        type="button"
        onclick={() => stream.clearSelection()}
        class="text-[8px] px-1.5 py-0.5"
        style:color="var(--text-muted)" style:border-color="var(--line)"
      >CLEAR</button>
    {/if}
  </header>

  <div class="px-3 py-2 border-b" style:border-color="var(--line)">
    {#if selected}
      <div class="row"><span class="k">ID</span><span class="v accent">#{selected.id}</span></div>
      <div class="row"><span class="k">PX</span><span class="v">{selected.cx.toFixed(0)} · {selected.cy.toFixed(0)}</span></div>
      {#if worldSelected}
        <div class="row"><span class="k">X · Y</span><span class="v accent">{worldSelected.x_m.toFixed(1)} · {worldSelected.y_m.toFixed(1)} m</span></div>
        <div class="row"><span class="k">RANGE</span><span class="v">{worldSelected.range_m.toFixed(1)} m ±{worldSelected.uncertainty_m.toFixed(1)}</span></div>
      {/if}
    {:else}
      <div class="text-[10px] text-dim py-2">CLICK A PERSON TO TRACK</div>
    {/if}
  </div>

  <!-- DENSE REGION world coords -->
  <header class="px-3 py-2 border-b label" style:border-color="var(--line)" style:background="var(--surface-2)">
    DENSE REGION · GROUND
  </header>

  <div class="px-3 py-2 border-b" style:border-color="var(--line)">
    {#if worldCentroid && frame?.cluster}
      <div class="row"><span class="k">X · Y</span><span class="v accent">{worldCentroid.x_m.toFixed(1)} · {worldCentroid.y_m.toFixed(1)} m</span></div>
      <div class="row"><span class="k">RANGE</span><span class="v">{worldCentroid.range_m.toFixed(1)} m ±{worldCentroid.uncertainty_m.toFixed(1)}</span></div>
      <div class="row"><span class="k">BEARING</span><span class="v">{worldCentroid.bearing_deg.toFixed(0)}°</span></div>
      <div class="row"><span class="k">MEMBERS</span><span class="v">{frame.cluster.member_count}</span></div>
    {:else}
      <div class="text-[10px] text-dim py-2">{frame?.cluster ? 'RAY · OFF GROUND' : 'NO CLUSTER'}</div>
    {/if}
  </div>

  <!-- POSE / sliders -->
  <header class="px-3 py-2 border-b label" style:border-color="var(--line)" style:background="var(--surface-2)">
    POSE · MANUAL
  </header>

  <div class="px-3 py-2 border-b" style:border-color="var(--line)">
    <div class="row mb-2"><span class="k">ALT AGL</span><span class="v accent">{stream.altitude} m</span></div>
    <input
      type="range" min={1} max={300} step={1}
      value={stream.altitude}
      oninput={(e) => stream.setAltitude(parseInt((e.target as HTMLInputElement).value))}
      class="w-full"
    />

    <div class="row mt-3 mb-2"><span class="k">TILT</span><span class="v accent">{stream.tilt.toFixed(0)}°</span></div>
    <input
      type="range" min={-90} max={-1} step={1}
      value={stream.tilt}
      oninput={(e) => stream.setTilt(parseInt((e.target as HTMLInputElement).value))}
      class="w-full"
    />
    <div class="flex justify-between text-[8px] text-dim mt-0.5">
      <span>NADIR -90°</span><span>HORIZON 0°</span>
    </div>

    <div class="row mt-3 mb-2"><span class="k">VFOV</span><span class="v">{stream.vfov}°</span></div>
    <input
      type="range" min={20} max={110} step={1}
      value={stream.vfov}
      oninput={(e) => stream.setVfov(parseInt((e.target as HTMLInputElement).value))}
      class="w-full"
    />
  </div>

  <!-- FEED section -->
  <header class="px-3 py-2 border-b label" style:border-color="var(--line)" style:background="var(--surface-2)">
    FEED
  </header>

  <div class="px-3 py-2 border-b" style:border-color="var(--line)">
    {#if info}
      <div class="text-[11px] truncate text-soft">{info.name}</div>
      <div class="text-[9px] text-muted mt-1 tracking-wider">
        {info.width}×{info.height} · {info.fps.toFixed(0)}F · {info.duration_s.toFixed(0)}s
      </div>
    {:else}
      <div class="text-[10px] text-dim">— NONE —</div>
    {/if}

    <div class="mt-3 pt-2 border-t" style:border-color="var(--line)">
      <div class="row">
        <span class="k">FRAME</span>
        <span class="v">{frame?.frame_idx.toString().padStart(5, '0') ?? '00000'} / {info?.frame_count ?? '----'}</span>
      </div>
      <div class="row">
        <span class="k">INF</span>
        <span class="v amber">{frame?.latency_ms.toFixed(0) ?? '--'} ms · {inferenceFps.toFixed(1)} fps</span>
      </div>
      <div class="row">
        <span class="k">STREAM</span>
        <span class="v cyan">{stream.fpsActual.toFixed(1)} fps</span>
      </div>
    </div>
  </div>

  <div class="flex-1"></div>

  <footer class="px-3 py-2 border-t text-[9px] text-dim leading-relaxed tracking-wider" style:border-color="var(--line)">
    YOLO11 // BYTETRACK<br/>
    PROJECTION // MANUAL POSE<br/>
    REAL-TIME &gt; JETSON + TRT
  </footer>
</aside>
