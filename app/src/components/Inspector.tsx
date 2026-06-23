import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { CollectionSummary } from '../api/types'
import type { EditablePoint } from '../canvas/AnnotationCanvas'
import type { DensityResult } from '../canvas/density'
import { useSelection } from '../state/selection'

interface Props {
  points: EditablePoint[]
  filteredPoints: EditablePoint[]
  setPoints: (next: EditablePoint[]) => void
  imageSize: [number, number]
  showHeatmap: boolean
  setShowHeatmap: (v: boolean) => void
  confidence: number
  setConfidence: (v: number) => void
  density: DensityResult | null
  hasImage: boolean
}

export function Inspector(p: Props) {
  const { collectionId, imageName, select, triggerRefresh } = useSelection()
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [summary, setSummary] = useState<CollectionSummary | null>(null)

  const peak = p.density ? { x: p.density.peakX, y: p.density.peakY } : null

  useEffect(() => {
    setReviewed(false)
    setStatusMsg(null)
    if (!collectionId || !imageName) return
    api.getAnnotation(collectionId, imageName).then((a) => {
      if (a) setReviewed(a.reviewed)
    })
  }, [collectionId, imageName])

  useEffect(() => {
    if (!collectionId) return
    api.getCollection(collectionId).then(setSummary)
  }, [collectionId])

  const reviewedCount = summary?.reviewed_count ?? 0
  const totalCount = summary?.downloaded_count ?? 0

  const runInference = useCallback(async () => {
    if (!collectionId || !imageName) return
    setBusy(true)
    setStatusMsg('Running P2PNet…')
    const t0 = performance.now()
    try {
      const r = await api.inferCollectionImage(collectionId, imageName)
      p.setPoints(
        r.points.map((pt) => ({ x: pt.x, y: pt.y, source: 'model' as const, confidence: pt.confidence })),
      )
      const elapsed = Math.round(performance.now() - t0)
      setStatusMsg(`Detected ${r.count} in ${elapsed}ms`)
    } catch (e) {
      setStatusMsg(`Error: ${e}`)
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
          points: p.filteredPoints.map((pt) => ({
            x: pt.x, y: pt.y, confidence: pt.confidence, source: pt.source,
          })),
          image_size: p.imageSize,
          reviewed: markReviewed,
        })
        setReviewed(markReviewed)
        setStatusMsg(markReviewed ? 'Marked reviewed' : 'Saved')
        triggerRefresh()
        if (collectionId) {
          api.getCollection(collectionId).then(setSummary)
        }
      } finally {
        setBusy(false)
      }
    },
    [collectionId, imageName, p.filteredPoints, p.imageSize, triggerRefresh],
  )

  const approveAndNext = useCallback(async () => {
    if (!collectionId || !imageName) return
    setBusy(true)
    try {
      await api.putAnnotation(collectionId, imageName, {
        points: p.filteredPoints.map((pt) => ({
          x: pt.x, y: pt.y, confidence: pt.confidence, source: pt.source,
        })),
        image_size: p.imageSize,
        reviewed: true,
      })
      triggerRefresh()
      api.getCollection(collectionId).then(setSummary)

      const freshList = await api.listImages(collectionId)
      const currentIdx = freshList.findIndex((i) => i.name === imageName)
      const nextUnreviewed =
        freshList.slice(currentIdx + 1).find((i) => !i.reviewed) ??
        freshList.slice(0, currentIdx).find((i) => !i.reviewed)

      if (nextUnreviewed) {
        select(collectionId, nextUnreviewed.name)
        setStatusMsg(null)
      } else {
        setReviewed(true)
        setStatusMsg('All images reviewed!')
      }
    } finally {
      setBusy(false)
    }
  }, [collectionId, imageName, p.filteredPoints, p.imageSize, select, triggerRefresh])

  return (
    <div className="h-full flex flex-col">
      <div
        className="p-3 border-b"
        style={{ borderColor: 'var(--color-line)', background: 'var(--color-panel-2)' }}
      >
        <Label>SELECTED IMAGE</Label>
        <div className="font-mono text-[12px] mt-1 truncate" title={imageName ?? ''}>
          {imageName ?? '— none —'}
        </div>
        <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
          {p.hasImage ? `${p.imageSize[0]} × ${p.imageSize[1]}` : ''}
        </div>
      </div>

      {totalCount > 0 && (
        <div
          className="px-3 py-2 border-b"
          style={{ borderColor: 'var(--color-line)', background: 'var(--color-panel-2)' }}
        >
          <div className="flex justify-between font-mono text-[10px] tracking-[0.1em] mb-1.5">
            <span style={{ color: 'var(--color-muted)' }}>REVIEW PROGRESS</span>
            <span style={{ color: reviewedCount === totalCount ? 'var(--color-ok)' : 'var(--color-accent)' }}>
              {reviewedCount} / {totalCount}
            </span>
          </div>
          <div className="w-full h-1.5" style={{ background: 'var(--color-line)' }}>
            <div
              className="h-full transition-all"
              style={{
                width: `${(reviewedCount / totalCount) * 100}%`,
                background: reviewedCount === totalCount ? 'var(--color-ok)' : 'var(--color-accent)',
              }}
            />
          </div>
        </div>
      )}

      <div className="p-3 space-y-4 flex-1 overflow-auto">
        <Stat label="COUNT" value={p.filteredPoints.length.toString().padStart(3, '0')} />
        <Stat label="DENSEST · X,Y" value={peak ? `${peak.x},${peak.y}` : '—'} />

        <button
          onClick={runInference}
          disabled={busy || !p.hasImage}
          className="w-full font-mono text-[12px] font-semibold tracking-[0.15em] px-3 py-2.5"
          style={{
            background: !p.hasImage ? 'var(--color-line)' : busy ? 'var(--color-warn)' : 'var(--color-accent)',
            color: '#000',
            opacity: !p.hasImage ? 0.5 : 1,
          }}
        >
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <span
                className="inline-block w-3 h-3 border-2 border-t-transparent rounded-full"
                style={{ borderColor: '#000', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }}
              />
              WORKING…
            </span>
          ) : 'RE-RUN INFERENCE'}
        </button>

        {statusMsg && (
          <div className="font-mono text-[10px]" style={{ color: 'var(--color-accent)' }}>
            {statusMsg}
          </div>
        )}

        <Toggle label="HEATMAP OVERLAY" value={p.showHeatmap} onChange={p.setShowHeatmap} />

        <div>
          <div className="flex justify-between font-mono text-[10px] mb-1.5 tracking-[0.1em]" style={{ color: 'var(--color-muted)' }}>
            <span>MIN CONFIDENCE</span>
            <span className="text-white">{p.confidence.toFixed(2)}</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.01}
            value={p.confidence}
            onChange={(e) => p.setConfidence(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div
          className="border p-2.5 font-mono text-[10px] space-y-1"
          style={{ borderColor: 'var(--color-line)', background: 'var(--color-panel-2)' }}
        >
          <Kbd k="CLICK">add dot</Kbd>
          <Kbd k="CLICK DOT">remove</Kbd>
          <Kbd k="DRAG DOT">move</Kbd>
          <Kbd k="SCROLL">zoom</Kbd>
          <Kbd k="SPACE+DRAG">pan</Kbd>
          <Kbd k="⌘Z">undo</Kbd>
        </div>
      </div>

      <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--color-line)' }}>
        <button
          onClick={approveAndNext}
          disabled={busy || !p.hasImage}
          className="w-full font-mono text-[12px] font-semibold tracking-[0.15em] px-3 py-2.5 disabled:opacity-50"
          style={{
            background: reviewed ? 'rgba(34,197,94,0.15)' : 'var(--color-ok)',
            color: reviewed ? 'var(--color-ok)' : '#000',
            border: '1px solid var(--color-ok)',
          }}
        >
          {reviewed ? '✓ APPROVED' : 'APPROVE & NEXT →'}
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => save(false)}
            disabled={busy || !p.hasImage}
            className="flex-1 font-mono text-[10px] font-semibold tracking-[0.15em] px-3 py-1.5 border disabled:opacity-50"
            style={{
              borderColor: 'var(--color-line-strong)',
              color: 'var(--color-muted)',
              background: 'var(--color-panel-2)',
            }}
          >
            SAVE DRAFT
          </button>
          <button
            onClick={() => save(true)}
            disabled={busy || !p.hasImage}
            className="flex-1 font-mono text-[10px] font-semibold tracking-[0.15em] px-3 py-1.5 border disabled:opacity-50"
            style={{
              borderColor: 'var(--color-line-strong)',
              color: 'var(--color-muted)',
              background: 'var(--color-panel-2)',
            }}
          >
            APPROVE ONLY
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="font-mono text-2xl mt-0.5" style={{ color: 'var(--color-accent)' }}>
        {value}
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono text-[10px] tracking-[0.2em] font-semibold"
      style={{ color: 'var(--color-muted)' }}
    >
      {children}
    </div>
  )
}

function Kbd({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span style={{ color: 'var(--color-accent)' }}>{k}</span>
      <span style={{ color: 'var(--color-muted)' }}>{children}</span>
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center justify-between w-full font-mono text-[11px] font-semibold tracking-[0.15em] border-0 bg-transparent"
      style={{ color: value ? 'var(--color-accent)' : 'var(--color-muted)' }}
    >
      <span>{label}</span>
      <span
        className="inline-block w-10 h-5 relative transition border"
        style={{
          background: value ? 'rgba(0,229,255,0.2)' : 'transparent',
          borderColor: value ? 'var(--color-accent)' : 'var(--color-line-strong)',
        }}
      >
        <span
          className="absolute top-0.5 w-3 h-3 transition"
          style={{
            background: value ? 'var(--color-accent)' : 'var(--color-muted)',
            left: value ? '24px' : '4px',
          }}
        />
      </span>
    </button>
  )
}
