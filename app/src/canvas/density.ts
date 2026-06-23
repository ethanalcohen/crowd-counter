export interface DensityResult {
  width: number
  height: number
  peakX: number
  peakY: number
  imageData: ImageData
}

export function computeDensity(
  points: Array<{ x: number; y: number }>,
  imageW: number,
  imageH: number,
  sigma = 12,
  downsample = 4,
): DensityResult {
  const w = Math.max(1, Math.floor(imageW / downsample))
  const h = Math.max(1, Math.floor(imageH / downsample))
  const heat = new Float32Array(w * h)

  const radius = Math.ceil(sigma * 3)
  const twoSig2 = 2 * sigma * sigma

  for (const p of points) {
    const cx = Math.floor(p.x / downsample)
    const cy = Math.floor(p.y / downsample)
    const x0 = Math.max(0, cx - radius)
    const x1 = Math.min(w - 1, cx + radius)
    const y0 = Math.max(0, cy - radius)
    const y1 = Math.min(h - 1, cy + radius)
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        heat[y * w + x] += Math.exp(-(dx * dx + dy * dy) / twoSig2)
      }
    }
  }

  let max = 0
  let peakIdx = 0
  for (let i = 0; i < heat.length; i++) {
    if (heat[i] > max) {
      max = heat[i]
      peakIdx = i
    }
  }
  const peakX = (peakIdx % w) * downsample
  const peakY = Math.floor(peakIdx / w) * downsample

  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < heat.length; i++) {
    const v = max > 0 ? heat[i] / max : 0
    const [r, g, b, a] = colormap(v)
    const o = i * 4
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = a
  }

  return {
    width: w,
    height: h,
    peakX,
    peakY,
    imageData: new ImageData(data, w, h),
  }
}

function colormap(v: number): [number, number, number, number] {
  if (v <= 0.001) return [0, 0, 0, 0]
  // viridis-ish purple → red → yellow
  const r = Math.round(255 * Math.min(1, 0.2 + v * 1.5))
  const g = Math.round(255 * Math.max(0, v - 0.3) * 1.5)
  const b = Math.round(255 * Math.max(0, 0.5 - v))
  const a = Math.round(220 * Math.min(1, v * 1.6))
  return [r, g, b, a]
}
