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
        timer = setTimeout(poll, modelLoaded ? 15000 : 2000)
      } catch {
        if (cancelled) return
        setHealth('connecting')
        timer = setTimeout(poll, 1500)
      }
    }
    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [modelLoaded])

  const pill =
    health === 'ok'
      ? modelLoaded
        ? { color: '#00e5ff', text: `P2PNET · ${device?.toUpperCase() ?? 'READY'}` }
        : { color: '#fbbf24', text: 'LOADING MODEL…' }
      : health === 'error'
        ? { color: '#ef4444', text: 'SIDECAR · ERROR' }
        : { color: '#8b95a3', text: 'CONNECTING…' }

  return (
    <header
      className="flex items-center justify-between border-b"
      style={{
        height: 44,
        borderColor: 'var(--color-line)',
        background: 'var(--color-panel)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-6 h-full pl-20" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <span className="font-mono text-[12px] font-semibold tracking-[0.25em]" style={{ color: 'var(--color-accent)' }}>
          CROWD/COUNTER
        </span>
        <nav className="flex h-full">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className="font-mono text-[12px] font-semibold tracking-[0.2em] px-5 h-full"
              style={{
                color: view === t.id ? '#000' : 'var(--color-text)',
                background: view === t.id ? 'var(--color-accent)' : 'transparent',
                border: 'none',
                borderRight: '1px solid var(--color-line)',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <div
        className="inline-flex items-center gap-2 font-mono text-[11px] tracking-widest px-3 py-1.5 border mr-3"
        style={{
          color: pill.color,
          borderColor: pill.color,
          background: 'rgba(0,229,255,0.05)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: pill.color, boxShadow: `0 0 8px ${pill.color}` }}
        />
        {pill.text}
      </div>
    </header>
  )
}
