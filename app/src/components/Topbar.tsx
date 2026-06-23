import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useSelection, type ViewMode } from '../state/selection'

type Health = 'connecting' | 'ok' | 'error'

const TABS: { id: ViewMode; label: string }[] = [
  { id: 'annotate', label: 'ANNOTATE' },
  { id: 'live', label: 'LIVE' },
]

export function Topbar() {
  const [health, setHealth] = useState<Health>('connecting')
  const [modelLoaded, setModelLoaded] = useState(false)
  const [device, setDevice] = useState<string | null>(null)
  const view = useSelection((s) => s.view)
  const setView = useSelection((s) => s.setView)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    async function poll() {
      try {
        const h = await api.health()
        if (cancelled) return
        setHealth(h.status === 'ok' ? 'ok' : 'error')
        setModelLoaded(h.model_loaded)
        setDevice(h.device)
        timer = setTimeout(poll, 5000)
      } catch {
        if (cancelled) return
        setHealth('connecting')
        timer = setTimeout(poll, 800)
      }
    }
    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  const pill =
    health === 'ok'
      ? modelLoaded
        ? { color: '#00e5ff', text: `P2PNET · ${device?.toUpperCase() ?? 'READY'}` }
        : { color: '#fbbf24', text: 'MODEL · UNLOADED' }
      : health === 'error'
        ? { color: '#ef4444', text: 'SIDECAR · ERROR' }
        : { color: '#6b7785', text: 'SIDECAR · BOOTING' }

  return (
    <header
      className="flex items-center justify-between px-4 h-10 border-b"
      style={{
        borderColor: 'var(--color-line)',
        background: 'var(--color-panel)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-6 pl-16" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <span className="font-mono text-xs tracking-[0.2em] text-white">CROWD/COUNTER</span>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className="font-mono text-[11px] tracking-[0.15em] px-3 py-1 rounded-sm transition"
              style={{
                color: view === t.id ? '#00e5ff' : 'var(--color-muted)',
                background: view === t.id ? 'rgba(0,229,255,0.08)' : 'transparent',
                borderBottom: view === t.id ? '1px solid #00e5ff' : '1px solid transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <div
        className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest px-2.5 py-1 border rounded-sm"
        style={{
          color: pill.color,
          borderColor: 'var(--color-line)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <span
          className="w-1.5 h-1.5"
          style={{ background: pill.color, boxShadow: `0 0 6px ${pill.color}` }}
        />
        {pill.text}
      </div>
    </header>
  )
}
