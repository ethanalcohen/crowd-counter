<script lang="ts">
  import { onMount } from 'svelte'
  import SourceList from './SourceList.svelte'
  import VideoCanvas from './VideoCanvas.svelte'
  import HUD from './HUD.svelte'
  import Timeline from './Timeline.svelte'
  import DetectionList from './DetectionList.svelte'
  import { stream } from '../stores/stream.svelte'

  type Health = { status: string; model_loaded: boolean; weights_source: string | null; device: string | null }
  let health = $state<Health | null>(null)

  async function pollHealth() {
    try {
      const r = await fetch('/api/health')
      health = await r.json()
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    pollHealth()
    const t = setInterval(pollHealth, health?.model_loaded ? 15000 : 1500)
    return () => clearInterval(t)
  })

  let healthPill = $derived(
    health
      ? health.model_loaded
        ? { color: '#22d3ee', text: `P2PNET · ${health.device?.toUpperCase() ?? 'READY'}` }
        : { color: '#fbbf24', text: 'LOADING MODEL…' }
      : { color: '#737373', text: 'CONNECTING…' },
  )
</script>

<div class="flex flex-col h-screen">
  <!-- topbar -->
  <header class="flex items-center justify-between h-10 border-b border-neutral-800 bg-neutral-950 px-4">
    <div class="flex items-center gap-6">
      <span class="font-mono text-[11px] tracking-[0.25em] text-cyan-400 font-semibold">CROWD/COUNTER</span>
      <span class="font-mono text-[10px] tracking-[0.2em] text-neutral-500">LIVE</span>
    </div>
    <div
      class="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest px-2.5 py-1 border"
      style:color={healthPill.color}
      style:border-color={healthPill.color}
    >
      <span class="w-1.5 h-1.5" style:background={healthPill.color} style:box-shadow="0 0 6px {healthPill.color}"></span>
      {healthPill.text}
    </div>
  </header>

  <!-- main 3-col -->
  <div class="flex flex-1 min-h-0">
    <SourceList />
    <main class="relative flex-1 min-w-0">
      <VideoCanvas />
      <HUD />
    </main>
    <DetectionList />
  </div>

  <Timeline />
</div>
