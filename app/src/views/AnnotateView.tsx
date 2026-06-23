import { useEffect, useState } from 'react'
import { AnnotationCanvas, type EditablePoint } from '../canvas/AnnotationCanvas'
import { Inspector } from '../components/Inspector'
import { useSelection } from '../state/selection'
import { api } from '../api/client'

export function AnnotateView() {
  const { collectionId, imageName } = useSelection()
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<[number, number]>([0, 0])
  const [points, setPoints] = useState<EditablePoint[]>([])
  const [history, setHistory] = useState<EditablePoint[][]>([])
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [confidence, setConfidence] = useState(0)

  useEffect(() => {
    setPoints([])
    setHistory([])
    setImageUrl(null)
    setImageSize([0, 0])
    if (!collectionId || !imageName) return

    let cancelled = false
    async function load() {
      const url = await api.imageUrl(collectionId!, imageName!)
      if (cancelled) return
      setImageUrl(url)

      const i = new Image()
      i.onload = () => {
        if (!cancelled) setImageSize([i.width, i.height])
      }
      i.src = url

      const ann = await api.getAnnotation(collectionId!, imageName!)
      if (cancelled) return
      if (ann) {
        setPoints(
          ann.points.map((p) => ({
            x: p.x, y: p.y, source: p.source, confidence: p.confidence,
          })),
        )
        setImageSize(ann.image_size)
      }
    }
    load()
    return () => { cancelled = true }
  }, [collectionId, imageName])

  const setPointsWithHistory = (next: EditablePoint[]) => {
    setHistory((h) => [...h.slice(-49), points])
    setPoints(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        setHistory((h) => {
          if (h.length === 0) return h
          setPoints(h[h.length - 1])
          return h.slice(0, -1)
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hasImage = imageUrl !== null
  const filtered = points.filter((p) => p.confidence >= confidence)

  return (
    <>
      <section className="flex-1 min-w-0 relative" style={{ background: '#0a0e13' }}>
        {hasImage ? (
          <AnnotationCanvas
            imageUrl={imageUrl!}
            points={filtered}
            onChange={setPointsWithHistory}
            showHeatmap={showHeatmap}
          />
        ) : (
          <EmptyCanvas />
        )}
      </section>

      {hasImage && (
        <aside
          className="w-72 border-l flex-shrink-0"
          style={{ borderColor: 'var(--color-line)', background: 'var(--color-panel)' }}
        >
          <Inspector
            points={points}
            setPoints={setPointsWithHistory}
            imageSize={imageSize}
            showHeatmap={showHeatmap}
            setShowHeatmap={setShowHeatmap}
            confidence={confidence}
            setConfidence={setConfidence}
          />
        </aside>
      )}
    </>
  )
}

function EmptyCanvas() {
  return (
    <>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,229,255,0.04) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(0,229,255,0.04) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div
        className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-widest"
        style={{ color: 'var(--color-muted)' }}
      >
        Select an image from the sidebar
      </div>
    </>
  )
}
