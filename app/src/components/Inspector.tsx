import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { EditablePoint } from '../canvas/AnnotationCanvas'
import { computeDensity } from '../canvas/density'
import { useSelection } from '../state/selection'

interface Props {
  points: EditablePoint[]
  setPoints: (next: EditablePoint[]) => void
  imageSize: [number, number]
  showHeatmap: boolean
  setShowHeatmap: (v: boolean) => void
  confidence: number
  setConfidence: (v: number) => void
}

export function Inspector(p: Props) {
  const { collectionId, imageName } = useSelection()
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(
    () => p.points.filter((pt) => pt.confidence >= p.confidence),
    [p.points, p.confidence],
  )

  const peak = useMemo(() => {
    if (filtered.length === 0 || p.imageSize[0] === 0) return null
    const d = computeDensity(filtered, p.imageSize[0], p.imageSize[1])
    return { x: d.peakX, y: d.peakY }
  }, [filtered, p.imageSize])

  useEffect(() => {
    setReviewed(false)
    if (!collectionId || !imageName) return
    api.getAnnotation(collectionId, imageName).then((a) => {
      if (a) setReviewed(a.reviewed)
    })
  }, [collectionId, imageName])

  const runInference = useCallback(async () => {
    if (!collectionId || !imageName) return
    setBusy(true)
    try {
      const r = await api.inferCollectionImage(collectionId, imageName)
      p.setPoints(
        r.points.map((pt) => ({ x: pt.x, y: pt.y, source: 'model' as const, confidence: pt.confidence })),
      )
    } finally {
      setBusy(false)
    }
  }, [collectionId, imageName, p])

  const save = useCallback(
    async (markReviewed: boolean) => {
      if (!collectionId || !imageName) return
      setBusy(true)
      try {
        await api.putAnnotation(collectionId, imageName, {
          points: filtered.map((pt) => ({ x: pt.x, y: pt.y, confidence: pt.confidence, source: pt.source })),
          image_size: p.imageSize,
          reviewed: markReviewed,
        })
        setReviewed(markReviewed)
      } finally {
        setBusy(false)
      }
    },
    [collectionId, imageName, filtered, p.imageSize],
  )

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b" style={{ borderColor: 'var(--color-line)' }}>
        <Label>IMAGE</Label>
        <div className="font-mono text-xs mt-1 truncate" title={imageName ?? ''}>
          {imageName ?? '—'}
        </div>
        <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
          {p.imageSize[0]} × {p.imageSize[1]}
        </div>
      </div>

      <div className="p-3 space-y-4 flex-1 overflow-auto">
        <Stat label="COUNT" value={filtered.length.toString().padStart(3, '0')} />
        <Stat
          label="DENSEST POINT · X,Y"
          value={peak ? `${peak.x},${peak.y}` : '—'}
        />

        <button
          onClick={runInference}
          disabled={busy}
          className="w-full font-mono text-[11px] tracking-[0.15em] px-3 py-2 border disabled:opacity-50"
          style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)', background: 'rgba(0,229,255,0.06)' }}
        >
          {busy ? '· WORKING ·' : '▸ RUN INFERENCE'}
        </button>

        <Toggle label="HEATMAP OVERLAY" value={p.showHeatmap} onChange={p.setShowHeatmap} />

        <div>
          <div className="flex justify-between font-mono text-[10px] mb-1 tracking-[0.1em]" style={{ color: 'var(--color-muted)' }}>
            <span>MIN CONFIDENCE</span>
            <span>{p.confidence.toFixed(2)}</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.01}
            value={p.confidence}
            onChange={(e) => p.setConfidence(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="font-mono text-[10px] space-y-0.5" style={{ color: 'var(--color-muted)' }}>
          <Kbd k="CLICK">add dot</Kbd>
          <Kbd k="CLICK DOT">remove</Kbd>
          <Kbd k="DRAG DOT">move</Kbd>
          <Kbd k="SCROLL">zoom</Kbd>
          <Kbd k="SPACE-DRAG">pan</Kbd>
          <Kbd k="⌘Z">undo</Kbd>
        </div>
      </div>

      <div className="p-3 border-t flex gap-2" style={{ borderColor: 'var(--color-line)' }}>
        <button
          onClick={() => save(false)}
          disabled={busy}
          className="flex-1 font-mono text-[11px] tracking-[0.15em] px-3 py-2 border disabled:opacity-50"
          style={{ borderColor: 'var(--color-line-strong)', color: 'white' }}
        >
          SAVE
        </button>
        <button
          onClick={() => save(true)}
          disabled={busy}
          className="flex-1 font-mono text-[11px] tracking-[0.15em] px-3 py-2 disabled:opacity-50"
          style={{
            background: reviewed ? 'rgba(0,229,255,0.15)' : 'var(--color-accent)',
            color: reviewed ? 'var(--color-accent)' : '#000',
            border: '1px solid var(--color-accent)',
          }}
        >
          {reviewed ? '✓ REVIEWED' : 'MARK REVIEWED'}
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="font-mono text-xl mt-0.5" style={{ color: 'var(--color-accent)' }}>
        {value}
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono text-[10px] tracking-[0.15em]"
      style={{ color: 'var(--color-muted)' }}
    >
      {children}
    </div>
  )
}

function Kbd({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span style={{ color: 'var(--color-text)' }}>{k}</span>
      <span>{children}</span>
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center justify-between w-full font-mono text-[10px] tracking-[0.15em]"
      style={{ color: value ? 'var(--color-accent)' : 'var(--color-muted)' }}
    >
      <span>{label}</span>
      <span
        className="inline-block w-8 h-3 relative transition border"
        style={{
          background: value ? 'rgba(0,229,255,0.2)' : 'transparent',
          borderColor: value ? 'var(--color-accent)' : 'var(--color-line-strong)',
        }}
      >
        <span
          className="absolute top-0 bottom-0 w-2 transition"
          style={{
            background: value ? 'var(--color-accent)' : 'var(--color-muted)',
            left: value ? '22px' : '2px',
          }}
        />
      </span>
    </button>
  )
}
