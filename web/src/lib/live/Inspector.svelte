<script lang="ts">
  import { stream } from '../stores/stream.svelte'
  import TrackMap from './TrackMap.svelte'

  let frame = $derived(stream.frame)
  let info = $derived(stream.info)
  let pose = $derived(frame?.pose ?? null)
  let world = $derived(frame?.peak_world ?? null)
  let inferenceFps = $derived(frame ? 1000 / Math.max(frame.inference.latency_ms, 1) : 0)

  const poseSourceColor: Record<string, string> = {
    drone: 'var(--amber-bright)',  /* hot — real telemetry */
    estimated: 'var(--yellow)',     /* warm — guessed from image */
    manual: 'var(--white-d)',       /* cold — hand-entered */
    none: 'var(--text-dim)',
  }
</script>

<aside class="h-full flex flex-col border-l w-80 overflow-y-auto" style:border-color="var(--line)" style:background="var(--surface)">

  <!-- TRACK section: map + count -->
  <header class="px-3 py-2 border-b label sticky top-0 z-10" style:border-color="var(--line)" style:background="var(--surface-2)">
    TRACK
  </header>

  <div class="px-3 py-3 border-b" style:border-color="var(--line)">
    <TrackMap />
  </div>

  <div class="px-3 py-2 border-b flex items-baseline justify-between" style:border-color="var(--line)">
    <div class="label">COUNT</div>
    <div class="text-[22px] leading-none tabular-nums" style:color="var(--accent)">
      {frame?.inference.count.toString().padStart(3, '0') ?? '---'}
    </div>
  </div>

  <!-- WORLD section -->
  <header class="px-3 py-2 border-b label flex justify-between items-center" style:border-color="var(--line)" style:background="var(--surface-2)">
    <span>WORLD · GROUND</span>
    {#if pose}
      <span class="text-[8px] px-1.5 py-0.5 border tabular-nums"
        style:color={poseSourceColor[pose.source]}
        style:border-color={poseSourceColor[pose.source]}>
        TELEM · {pose.source.toUpperCase()}
      </span>
    {/if}
  </header>

  <div class="px-3 py-2 border-b" style:border-color="var(--line)">
    {#if world}
      <div class="row"><span class="k">X · Y</span><span class="v accent">{world.x_m.toFixed(1)} · {world.y_m.toFixed(1)} m</span></div>
      <div class="row"><span class="k">RANGE</span><span class="v">{world.range_m.toFixed(1)} m ±{world.uncertainty_m.toFixed(1)}</span></div>
      <div class="row"><span class="k">BEARING</span><span class="v">{world.bearing_deg.toFixed(0)}°</span></div>
      {#if world.lat !== null && world.lon !== null}
        <div class="row"><span class="k">LAT · LON</span><span class="v">{world.lat.toFixed(5)} · {world.lon.toFixed(5)}</span></div>
      {/if}
    {:else}
      <div class="text-[10px] text-dim py-2">{pose ? 'RAY · OFF GROUND' : 'AWAITING POSE'}</div>
    {/if}
  </div>

  <!-- POSE section + altitude control -->
  <header class="px-3 py-2 border-b label" style:border-color="var(--line)" style:background="var(--surface-2)">
    POSE · ESTIMATE
  </header>

  <div class="px-3 py-2 border-b" style:border-color="var(--line)">
    {#if pose}
      <div class="row"><span class="k">PITCH</span><span class="v">{pose.pitch_deg.toFixed(1)}°</span></div>
      <div class="row"><span class="k">ROLL</span><span class="v">{pose.roll_deg.toFixed(1)}°</span></div>
      <div class="row"><span class="k">VFOV</span><span class="v">{pose.vfov_deg?.toFixed(0) ?? '--'}°</span></div>
      <div class="row"><span class="k">CONF</span><span class="v">{(pose.confidence * 100).toFixed(0)}%</span></div>
    {:else}
      <div class="text-[10px] text-dim py-2">PERSPECTIVEFIELDS · COLD</div>
    {/if}

    <div class="mt-3 pt-3 border-t" style:border-color="var(--line)">
      <div class="row mb-2"><span class="k">ALT AGL</span><span class="v">{stream.altitude} m</span></div>
      <input
        type="range" min={1} max={200} step={1}
        value={stream.altitude}
        oninput={(e) => stream.setAltitude(parseInt((e.target as HTMLInputElement).value))}
        class="w-full"
      />
    </div>

    <button
      type="button"
      onclick={() => stream.reestimatePose()}
      class="w-full mt-3"
    >
      RE-ESTIMATE
    </button>
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
        <span class="k">PX</span>
        <span class="v">{frame ? `${frame.inference.peak_xy[0]} · ${frame.inference.peak_xy[1]}` : '---'}</span>
      </div>
      <div class="row">
        <span class="k">INF</span>
        <span class="v amber">{frame?.inference.latency_ms.toFixed(0) ?? '--'} ms · {inferenceFps.toFixed(1)} fps</span>
      </div>
      <div class="row">
        <span class="k">STREAM</span>
        <span class="v cyan">{stream.fpsActual.toFixed(1)} fps</span>
      </div>
    </div>
  </div>

  <div class="flex-1"></div>

  <footer class="px-3 py-2 border-t text-[9px] text-dim leading-relaxed tracking-wider" style:border-color="var(--line)">
    P2PNET // 21M // MPS<br/>
    POSE // PERSPECTIVEFIELDS<br/>
    REAL-TIME &gt; JETSON + TRT
  </footer>
</aside>
