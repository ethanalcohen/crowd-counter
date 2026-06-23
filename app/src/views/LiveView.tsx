import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { computeDensity } from '../canvas/density'
import type { CollectionImageEntry, CollectionSummary, InferResponse } from '../api/types'

interface Frame {
  imageName: string
  imageUrl: string
  width: number
  height: number
  result: InferResponse
  latencyMs: number
  framedAt: number
}

interface PeakSample {
  nx: number      // normalized x [0..1]
  ny: number
  count: number
  t: number
}

export function LiveView() {
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [images, setImages] = useState<CollectionImageEntry[]>([])
  const [intervalMs, setIntervalMs] = useState(800)
  const [playing, setPlaying] = useState(true)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [trail, setTrail] = useState<PeakSample[]>([])
  const [frameCount, setFrameCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const idxRef = useRef(0)
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [renderedSize, setRenderedSize] = useState({ w: 0, h: 0, ox: 0, oy: 0 })

  // load collections + auto-pick the first with downloaded images
  useEffect(() => {
    api.listCollections().then((cs) => {
      setCollections(cs)
      if (!sourceId) {
        const first = cs.find((c) => c.downloaded_count > 0)
        if (first) setSourceId(first.id)
      }
    }).catch((e) => setError(String(e)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // load image list for active source
  useEffect(() => {
    if (!sourceId) return
    setImages([])
    idxRef.current = 0
    setTrail([])
    setFrameCount(0)
    api.listImages(sourceId).then(setImages).catch((e) => setError(String(e)))
  }, [sourceId])

  // playback loop
  useEffect(() => {
    if (!playing || !sourceId || images.length === 0) return
    let cancelled = false

    async function step() {
      if (cancelled) return
      const img = images[idxRef.current % images.length]
      idxRef.current = (idxRef.current + 1) % images.length
      try {
        const url = await api.imageUrl(sourceId!, img.name)
        const t0 = performance.now()
        const result = await api.inferCollectionImage(sourceId!, img.name)
        const latencyMs = performance.now() - t0
        const [w, h] = result.image_size
        const f: Frame = {
          imageName: img.name,
          imageUrl: url,
          width: w,
          height: h,
          result,
          latencyMs,
          framedAt: performance.now(),
        }
        if (cancelled) return
        setFrame(f)
        setFrameCount((c) => c + 1)
        setTrail((prev) => {
          const sample: PeakSample = {
            nx: result.peak_xy[0] / w,
            ny: result.peak_xy[1] / h,
            count: result.count,
            t: performance.now(),
          }
          return [...prev.slice(-79), sample]
        })
      } catch (e) {
        setError(String(e))
      }
      if (!cancelled) {
        tickRef.current = setTimeout(step, intervalMs)
      }
    }
    step()
    return () => {
      cancelled = true
      if (tickRef.current) clearTimeout(tickRef.current)
    }
  }, [playing, sourceId, images, intervalMs])

  // measure rendered image size for overlays
  useEffect(() => {
    if (!frame || !imgRef.current || !containerRef.current) return
    const recompute = () => {
      if (!imgRef.current || !containerRef.current) return
      const c = containerRef.current.getBoundingClientRect()
      const aspect = frame.width / frame.height
      let w = c.width
      let h = c.width / aspect
      if (h > c.height) {
        h = c.height
        w = c.height * aspect
      }
      setRenderedSize({ w, h, ox: (c.width - w) / 2, oy: (c.height - h) / 2 })
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [frame])

  // render heatmap overlay
  useEffect(() => {
    if (!frame || !overlayRef.current) return
    const canvas = overlayRef.current
    canvas.width = renderedSize.w || 1
    canvas.height = renderedSize.h || 1
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const d = computeDensity(frame.result.points, frame.width, frame.height)
    const off = document.createElement('canvas')
    off.width = d.width
    off.height = d.height
    off.getContext('2d')!.putImageData(d.imageData, 0, 0)
    ctx.globalAlpha = 0.6
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = 1
  }, [frame, renderedSize])

  const downloaded = collections.filter((c) => c.downloaded_count > 0)
  const peak = frame ? frame.result.peak_xy : null
  const renderedPeak = peak && renderedSize.w
    ? { x: (peak[0] / frame!.width) * renderedSize.w, y: (peak[1] / frame!.height) * renderedSize.h }
    : null

  const fps = useMemo(() => {
    if (trail.length < 2) return 0
    const span = (trail[trail.length - 1].t - trail[0].t) / 1000
    return span > 0 ? trail.length / span : 0
  }, [trail])

  if (error) {
    return (
      <div className="p-6 font-mono text-xs" style={{ color: '#ef4444' }}>
        {error}
      </div>
    )
  }

  if (downloaded.length === 0) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center font-mono text-xs uppercase tracking-widest"
        style={{ color: 'var(--color-muted)' }}
      >
        Download a collection to start the live feed
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div ref={containerRef} className="flex-1 relative" style={{ background: '#0a0e13' }}>
        <BackgroundGrid />
        {frame && (
          <>
            <img
              ref={imgRef}
              src={frame.imageUrl}
              alt=""
              className="absolute"
              style={{
                left: renderedSize.ox,
                top: renderedSize.oy,
                width: renderedSize.w,
                height: renderedSize.h,
                objectFit: 'contain',
              }}
            />
            <canvas
              ref={overlayRef}
              className="absolute pointer-events-none"
              style={{ left: renderedSize.ox, top: renderedSize.oy }}
            />
            {renderedPeak && (
              <PeakMarker
                x={renderedSize.ox + renderedPeak.x}
                y={renderedSize.oy + renderedPeak.y}
                peakXY={peak!}
              />
            )}
          </>
        )}

        <Hud
          source={sourceId ?? ''}
          frameName={frame?.imageName ?? '—'}
          count={frame?.result.count ?? 0}
          peak={peak}
          latencyMs={frame?.latencyMs ?? 0}
          fps={fps}
          frameIdx={frameCount}
          totalFrames={images.length}
        />
      </div>

      <aside
        className="w-72 border-l flex-shrink-0 flex flex-col"
        style={{ borderColor: 'var(--color-line)', background: 'var(--color-panel)' }}
      >
        <Section title="SOURCE">
          <select
            value={sourceId ?? ''}
            onChange={(e) => setSourceId(e.target.value)}
            className="w-full font-mono text-xs px-2 py-1.5 border bg-transparent"
            style={{ borderColor: 'var(--color-line)', color: 'white' }}
          >
            {downloaded.map((c) => (
              <option key={c.id} value={c.id} style={{ background: '#0a0e13' }}>
                {c.name} ({c.downloaded_count})
              </option>
            ))}
          </select>
        </Section>

        <Section title="PLAYBACK">
          <div className="flex gap-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="flex-1 font-mono text-xs px-3 py-1.5 border"
              style={{
                borderColor: playing ? '#00e5ff' : 'var(--color-line)',
                color: playing ? '#00e5ff' : 'white',
                background: playing ? 'rgba(0,229,255,0.08)' : 'transparent',
              }}
            >
              {playing ? '⏸ PAUSE' : '▶ PLAY'}
            </button>
            <button
              onClick={() => {
                idxRef.current = 0
                setTrail([])
                setFrameCount(0)
              }}
              className="font-mono text-xs px-3 py-1.5 border"
              style={{ borderColor: 'var(--color-line)', color: 'white' }}
            >
              ↺
            </button>
          </div>
          <div className="mt-3">
            <Label>FRAME INTERVAL · {intervalMs}ms</Label>
            <input
              type="range" min={100} max={3000} step={100}
              value={intervalMs}
              onChange={(e) => setIntervalMs(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        </Section>

        <Section title="TARGET HISTORY">
          <TrailPlot trail={trail} />
        </Section>

        <div className="flex-1" />

        <div className="p-3 border-t font-mono text-[10px]" style={{ borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
          INFERENCE · STUB MODEL
          <br />
          REAL P2PNET/CSRNET PENDING
        </div>
      </aside>
    </div>
  )
}

function PeakMarker({ x, y, peakXY }: { x: number; y: number; peakXY: [number, number] }) {
  return (
    <div className="absolute pointer-events-none" style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}>
      <svg width={80} height={80} style={{ overflow: 'visible' }}>
        <circle cx={40} cy={40} r={20} fill="none" stroke="#00e5ff" strokeWidth={1.5} />
        <circle cx={40} cy={40} r={3} fill="#00e5ff" />
        <line x1={40} y1={0} x2={40} y2={20} stroke="#00e5ff" strokeWidth={1} />
        <line x1={40} y1={60} x2={40} y2={80} stroke="#00e5ff" strokeWidth={1} />
        <line x1={0} y1={40} x2={20} y2={40} stroke="#00e5ff" strokeWidth={1} />
        <line x1={60} y1={40} x2={80} y2={40} stroke="#00e5ff" strokeWidth={1} />
      </svg>
      <div
        className="font-mono text-[10px] absolute whitespace-nowrap"
        style={{ left: 88, top: 32, color: '#00e5ff', textShadow: '0 0 4px rgba(0,0,0,0.8)' }}
      >
        TGT · {peakXY[0]},{peakXY[1]}
      </div>
    </div>
  )
}

function BackgroundGrid() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage:
          'linear-gradient(rgba(0,229,255,0.04) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(0,229,255,0.04) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }}
    />
  )
}

function Hud({
  source, frameName, count, peak, latencyMs, fps, frameIdx, totalFrames,
}: {
  source: string
  frameName: string
  count: number
  peak: [number, number] | null
  latencyMs: number
  fps: number
  frameIdx: number
  totalFrames: number
}) {
  return (
    <>
      <div
        className="absolute top-3 left-3 px-3 py-2 border font-mono text-[10px]"
        style={{ borderColor: 'var(--color-line)', background: 'rgba(10,14,19,0.85)', color: '#00e5ff' }}
      >
        <div className="text-white/60">SOURCE</div>
        <div className="mt-0.5">{source.toUpperCase()}</div>
        <div className="text-white/60 mt-2">FRAME</div>
        <div className="mt-0.5">{frameIdx.toString().padStart(5, '0')} / {totalFrames}</div>
        <div className="text-white/60 mt-2">FILE</div>
        <div className="mt-0.5 truncate max-w-[200px]" title={frameName}>{frameName}</div>
      </div>

      <div
        className="absolute top-3 right-3 px-3 py-2 border font-mono text-[10px] text-right"
        style={{ borderColor: 'var(--color-line)', background: 'rgba(10,14,19,0.85)', color: '#00e5ff' }}
      >
        <div className="text-white/60">COUNT</div>
        <div className="text-2xl mt-0.5">{count.toString().padStart(3, '0')}</div>
        <div className="text-white/60 mt-2">PEAK · X,Y</div>
        <div className="mt-0.5">{peak ? `${peak[0]},${peak[1]}` : '—'}</div>
        <div className="text-white/60 mt-2">LATENCY · FPS</div>
        <div className="mt-0.5">{latencyMs.toFixed(0)}ms · {fps.toFixed(1)}</div>
      </div>
    </>
  )
}

function TrailPlot({ trail }: { trail: PeakSample[] }) {
  if (trail.length === 0) {
    return (
      <div className="font-mono text-[10px]" style={{ color: 'var(--color-muted)' }}>
        no samples yet
      </div>
    )
  }
  const max = Math.max(...trail.map((t) => t.count), 1)
  return (
    <div>
      <div
        className="relative w-full aspect-square border"
        style={{ borderColor: 'var(--color-line)', background: '#0a0e13' }}
      >
        {/* normalized peak positions */}
        {trail.map((s, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${s.nx * 100}%`,
              top: `${s.ny * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 4 + (s.count / max) * 6,
              height: 4 + (s.count / max) * 6,
              background: i === trail.length - 1 ? '#00e5ff' : 'rgba(0,229,255,0.3)',
              boxShadow: i === trail.length - 1 ? '0 0 8px #00e5ff' : 'none',
              opacity: 0.3 + (i / trail.length) * 0.7,
            }}
          />
        ))}
        {/* center axes */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{ background: 'rgba(0,229,255,0.15)' }} />
          <div className="absolute top-1/2 left-0 right-0 h-px" style={{ background: 'rgba(0,229,255,0.15)' }} />
        </div>
      </div>
      <div className="font-mono text-[10px] mt-1 flex justify-between" style={{ color: 'var(--color-muted)' }}>
        <span>{trail.length} SAMPLES</span>
        <span>MAX {max}</span>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-3 border-b" style={{ borderColor: 'var(--color-line)' }}>
      <Label>{title}</Label>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.15em]" style={{ color: 'var(--color-muted)' }}>
      {children}
    </div>
  )
}
