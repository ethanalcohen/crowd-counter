import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Image as KImage, Layer, Stage } from 'react-konva'
import type Konva from 'konva'
import type { DensityResult } from './density'

export interface EditablePoint {
  x: number
  y: number
  source: 'model' | 'user'
  confidence: number
}

interface Props {
  imageUrl: string
  points: EditablePoint[]
  onChange: (next: EditablePoint[]) => void
  density: DensityResult | null   // computed by parent (one source of truth)
  showHeatmap: boolean
}

export function AnnotationCanvas({ imageUrl, points, onChange, density, showHeatmap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [container, setContainer] = useState({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [spaceDown, setSpaceDown] = useState(false)

  useEffect(() => {
    const i = new window.Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => setImg(i)
    i.src = imageUrl
    return () => { i.onload = null }
  }, [imageUrl])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setContainer({ w: r.width, h: r.height })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!img || container.w === 0) return
    const s = Math.min(container.w / img.width, container.h / img.height) * 0.95
    setScale(s)
    setPos({
      x: (container.w - img.width * s) / 2,
      y: (container.h - img.height * s) / 2,
    })
  }, [img, container])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // build heatmap canvas only when density changes
  const heatmapCanvas = useMemo(() => {
    if (!density) return null
    const c = document.createElement('canvas')
    c.width = density.width
    c.height = density.height
    c.getContext('2d')!.putImageData(density.imageData, 0, 0)
    return c
  }, [density])

  const peak = density && points.length > 0 ? { x: density.peakX, y: density.peakY } : null

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const oldScale = scale
    const direction = e.evt.deltaY < 0 ? 1 : -1
    const factor = 1 + direction * 0.1
    const newScale = Math.max(0.05, Math.min(20, oldScale * factor))
    const mx = (pointer.x - pos.x) / oldScale
    const my = (pointer.y - pos.y) / oldScale
    setScale(newScale)
    setPos({
      x: pointer.x - mx * newScale,
      y: pointer.y - my * newScale,
    })
  }

  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent>) {
    if (spaceDown) return
    if (e.target !== e.currentTarget && e.target.name() === 'dot') return
    if (!img) return
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const x = (pointer.x - pos.x) / scale
    const y = (pointer.y - pos.y) / scale
    if (x < 0 || y < 0 || x > img.width || y > img.height) return
    onChange([...points, { x, y, source: 'user', confidence: 1 }])
  }

  function removeAt(index: number) {
    const next = points.slice()
    next.splice(index, 1)
    onChange(next)
  }

  function moveAt(index: number, x: number, y: number) {
    const next = points.slice()
    next[index] = { ...next[index], x, y, source: 'user' }
    onChange(next)
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden"
      style={{
        cursor: spaceDown ? 'grab' : 'crosshair',
        background: '#000',
      }}
    >
      <Stage
        ref={stageRef}
        width={container.w}
        height={container.h}
        onWheel={handleWheel}
        onClick={handleStageClick}
        draggable={spaceDown}
        x={pos.x}
        y={pos.y}
        scaleX={scale}
        scaleY={scale}
        onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
      >
        <Layer listening={false}>
          {img && <KImage image={img} />}
          {showHeatmap && heatmapCanvas && img && (
            <KImage
              image={heatmapCanvas}
              width={img.width}
              height={img.height}
              opacity={0.65}
            />
          )}
        </Layer>
        <Layer>
          {img && points.map((p, i) => (
            <Circle
              key={i}
              name="dot"
              x={p.x}
              y={p.y}
              radius={6 / scale}
              fill={p.source === 'user' ? '#22c55e' : '#00e5ff'}
              stroke="black"
              strokeWidth={1.5 / scale}
              draggable
              onClick={(e) => {
                e.cancelBubble = true
                removeAt(i)
              }}
              onDragEnd={(e) => moveAt(i, e.target.x(), e.target.y())}
            />
          ))}
          {img && peak && (
            <>
              <Circle
                x={peak.x}
                y={peak.y}
                radius={18 / scale}
                stroke="#00e5ff"
                strokeWidth={2 / scale}
                listening={false}
              />
              <Circle
                x={peak.x}
                y={peak.y}
                radius={4 / scale}
                fill="#00e5ff"
                listening={false}
              />
            </>
          )}
        </Layer>
      </Stage>
    </div>
  )
}
