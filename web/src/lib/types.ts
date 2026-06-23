export interface VideoInfo {
  id: string
  name: string
  path: string
  duration_s: number
  fps: number
  width: number
  height: number
  frame_count: number
  size_bytes: number
}

export interface Point {
  x: number
  y: number
  confidence: number
}

export interface FrameInference {
  count: number
  peak_xy: [number, number]
  points: Point[]
  latency_ms: number
}

export interface FrameAnalysis {
  type: 'frame'
  frame_idx: number
  t_ms: number
  width: number
  height: number
  frame_jpeg_b64: string
  heatmap_jpeg_b64: string
  inference: FrameInference
}

export interface StreamInfo {
  type: 'info'
  info: VideoInfo
}

export type StreamMessage = FrameAnalysis | StreamInfo | { type: 'error'; error: string }
