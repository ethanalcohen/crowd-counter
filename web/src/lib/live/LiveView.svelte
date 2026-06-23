<script lang="ts">
  import { onMount } from 'svelte'
  import SourceList from './SourceList.svelte'
  import VideoCanvas from './VideoCanvas.svelte'
  import Timeline from './Timeline.svelte'
  import Inspector from './Inspector.svelte'
  import { stream } from '../stores/stream.svelte'

  type Health = { status: string; model_loaded: boolean; weights_source: string | null; device: string | null }
  let health = $state<Health | null>(null)
  let bootedAt = Date.now()
  let nowTick = $state(Date.now())

  async function pollHealth() {
    try {
      const r = await fetch('/api/health')
      health = await r.json()
    } catch { /* ignore */ }
  }

  onMount(() => {
    pollHealth()
    const h = setInterval(pollHealth, health?.model_loaded ? 15000 : 1500)
    const t = setInterval(() => (nowTick = Date.now()), 1000)
    return () => { clearInterval(h); clearInterval(t) }
  })

  let uptime = $derived.by(() => {
    const s = Math.floor((nowTick - bootedAt) / 1000)
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  })

  let sidecarStatus = $derived(health ? (health.status === 'ok' ? 'OK' : 'ERR') : '---')
  let modelStatus = $derived(health ? (health.model_loaded ? (health.device?.toUpperCase() ?? 'READY') : 'LOADING') : '---')
  let sidecarColor = $derived(health?.status === 'ok' ? 'var(--ok)' : 'var(--amber)')
  let modelColor = $derived(health?.model_loaded ? 'var(--cyan)' : 'var(--amber)')
</script>

<div class="flex flex-col h-screen">
  <!-- topbar — compact readout strip -->
  <header class="flex items-center h-8 border-b" style:border-color="var(--line)" style:background="var(--surface)">
    <div class="px-3 h-full flex items-center border-r" style:border-color="var(--line)">
      <span class="label text-accent" style:color="var(--accent)" style:font-weight="600">CROWD//COUNTER</span>
    </div>
    <div class="px-3 h-full flex items-center border-r label" style:border-color="var(--line)">LIVE</div>

    <!-- spacer -->
    <div class="flex-1"></div>

    <!-- status strip -->
    <div class="flex h-full">
      <div class="flex items-center gap-2 px-3 border-l h-full" style:border-color="var(--line)">
        <span class="label">SIDECAR</span>
        <span class="w-1.5 h-1.5" style:background={sidecarColor}></span>
        <span style:color={sidecarColor} class="text-[10px]">{sidecarStatus}</span>
      </div>
      <div class="flex items-center gap-2 px-3 border-l h-full" style:border-color="var(--line)">
        <span class="label">MODEL</span>
        <span class="w-1.5 h-1.5" style:background={modelColor}></span>
        <span style:color={modelColor} class="text-[10px]">{modelStatus}</span>
      </div>
      <div class="flex items-center gap-2 px-3 border-l h-full" style:border-color="var(--line)">
        <span class="label">UPTIME</span>
        <span class="text-[10px] text-soft tabular-nums">{uptime}</span>
      </div>
    </div>
  </header>

  <!-- main 3-col -->
  <div class="flex flex-1 min-h-0">
    <SourceList />
    <main class="relative flex-1 min-w-0">
      <VideoCanvas />
    </main>
    <Inspector />
  </div>

  <Timeline />
</div>
