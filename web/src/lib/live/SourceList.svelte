<script lang="ts">
  import { onMount } from 'svelte'
  import type { VideoInfo } from '../types'
  import { stream } from '../stores/stream.svelte'

  let videos = $state<VideoInfo[]>([])
  let loading = $state(true)

  async function refresh() {
    try {
      const r = await fetch('/api/videos')
      videos = await r.json()
    } catch (e) {
      console.error(e)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  })

  function fmtBytes(b: number) {
    return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`
  }
  function fmtDur(s: number) {
    const m = Math.floor(s / 60)
    return `${m}:${String(Math.floor(s - m * 60)).padStart(2, '0')}`
  }
</script>

<aside class="h-full flex flex-col border-r border-neutral-800 bg-neutral-950 w-64">
  <header class="px-3 py-2 border-b border-neutral-800 font-mono text-[10px] tracking-[0.2em] text-neutral-500">
    SOURCES
  </header>

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <div class="p-3 font-mono text-[10px] text-neutral-500">SCANNING…</div>
    {:else if videos.length === 0}
      <div class="p-3 font-mono text-[10px] text-neutral-500 leading-relaxed">
        no videos found.<br/><br/>
        drop .mp4 files into<br/>
        <code class="text-cyan-400 text-[9px]">~/Library/Application Support/CrowdCounter/videos/</code>
      </div>
    {:else}
      {#each videos as v (v.id)}
        <button
          type="button"
          onclick={() => stream.connect(v.id)}
          class="w-full text-left px-3 py-2 border-b border-neutral-900 hover:bg-neutral-900 transition"
          class:bg-cyan-950={stream.videoId === v.id}
          style:border-left={stream.videoId === v.id ? '3px solid #22d3ee' : '3px solid transparent'}
        >
          <div class="text-[12px] truncate" class:text-cyan-400={stream.videoId === v.id}>
            {v.name}
          </div>
          <div class="font-mono text-[10px] text-neutral-500 mt-0.5 tracking-[0.05em]">
            {v.width}×{v.height} · {v.fps.toFixed(0)} FPS · {fmtDur(v.duration_s)} · {fmtBytes(v.size_bytes)}
          </div>
        </button>
      {/each}
    {/if}
  </div>

  <footer class="px-3 py-2 border-t border-neutral-800 font-mono text-[9px] text-neutral-600">
    {videos.length} {videos.length === 1 ? 'SOURCE' : 'SOURCES'}
  </footer>
</aside>
