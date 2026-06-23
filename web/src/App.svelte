<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  type Health = { status: string; model_loaded: boolean; weights_source: string | null; device: string | null }

  let health = $state<Health | null>(null)
  let error = $state<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function poll() {
    try {
      const r = await fetch('/api/health')
      health = await r.json()
      error = null
    } catch (e) {
      error = String(e)
    }
    timer = setTimeout(poll, health?.model_loaded ? 15000 : 1500)
  }

  onMount(poll)
  onDestroy(() => { if (timer) clearTimeout(timer) })
</script>

<div class="h-screen flex flex-col items-center justify-center gap-6 font-mono">
  <div class="text-xs tracking-[0.3em] text-cyan-400">CROWD / COUNTER · V2</div>
  <div class="text-[10px] tracking-[0.2em] text-neutral-500">PHASE 0 · SCAFFOLD</div>

  <div class="border border-neutral-700 px-6 py-4 text-xs">
    {#if error}
      <div class="text-red-400">SIDECAR · {error}</div>
    {:else if health}
      <div class="flex flex-col gap-1">
        <div>
          <span class="text-neutral-500">SIDECAR</span>
          <span class="ml-2 text-cyan-400">{health.status.toUpperCase()}</span>
        </div>
        <div>
          <span class="text-neutral-500">MODEL</span>
          <span class="ml-2" class:text-cyan-400={health.model_loaded} class:text-amber-400={!health.model_loaded}>
            {health.model_loaded ? 'READY' : 'LOADING…'}
          </span>
        </div>
        {#if health.weights_source}
          <div>
            <span class="text-neutral-500">WEIGHTS</span>
            <span class="ml-2 text-neutral-300">{health.weights_source}</span>
          </div>
        {/if}
        {#if health.device}
          <div>
            <span class="text-neutral-500">DEVICE</span>
            <span class="ml-2 text-neutral-300">{health.device.toUpperCase()}</span>
          </div>
        {/if}
      </div>
    {:else}
      <div class="text-neutral-500">CONNECTING…</div>
    {/if}
  </div>

  <div class="text-[10px] tracking-[0.15em] text-neutral-600 max-w-md text-center">
    Live view UI lands in Phase 1.<br/>This is just the sidecar handshake.
  </div>
</div>
