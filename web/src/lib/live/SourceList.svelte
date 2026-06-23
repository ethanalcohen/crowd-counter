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
    } catch (e) { console.error(e) } finally { loading = false }
  }

  onMount(() => {
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  })

  function fmtDur(s: number) {
    const m = Math.floor(s / 60)
    return `${m}:${String(Math.floor(s - m * 60)).padStart(2, '0')}`
  }
</script>

<aside class="h-full flex flex-col border-r w-60" style:border-color="var(--line)" style:background="var(--surface)">
  <header class="px-3 py-2 border-b label" style:border-color="var(--line)" style:background="var(--surface-2)">
    FEEDS · {videos.length}
  </header>

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <div class="p-3 text-[10px] text-muted">SCANNING…</div>
    {:else if videos.length === 0}
      <div class="p-3 text-[10px] text-muted leading-relaxed">
        no feeds.<br/><br/>
        drop .mp4 into:<br/>
        <span class="text-cyan text-[9px]">~/Library/Application Support/CrowdCounter/videos/</span>
      </div>
    {:else}
      {#each videos as v (v.id)}
        {@const selected = stream.videoId === v.id}
        <button
          type="button"
          onclick={() => stream.connect(v.id)}
          class="w-full text-left px-3 py-2 border-b block hover:bg-[var(--surface-2)] transition"
          style:border-color="var(--line)"
          style:background={selected ? 'var(--accent-dim)' : 'transparent'}
          style:border-left={selected ? '2px solid var(--accent)' : '2px solid transparent'}
          style:text-transform="none"
          style:letter-spacing="normal"
          style:font-size="11px"
          style:padding="8px 10px"
        >
          <div class="flex items-center gap-2">
            <span class="w-1 h-1" style:background={selected ? 'var(--accent)' : 'var(--text-dim)'}></span>
            <span class="flex-1 truncate" style:color={selected ? 'var(--accent)' : 'var(--text)'}>
              {v.name}
            </span>
          </div>
          <div class="text-[9px] text-muted mt-0.5 pl-3 tracking-wider">
            {v.width}×{v.height} · {v.fps.toFixed(0)}F · {fmtDur(v.duration_s)}
          </div>
        </button>
      {/each}
    {/if}
  </div>
</aside>
