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

export interface Detection {
  id: number
  cx: number
  cy: number
  bbox: [number, number, number, number]   // x, y, w, h (top-left + size)
  conf: number
}

export interface ClusterData {
  cx: number
  cy: number
  radius_px: number
  member_count: number
}

export interface SelectedTrack {
  id: number
  cx: number
  cy: number
  bbox: [number, number, number, number]
}

export interface CentroidTrailEntry {
  nx: number
  ny: number
  t_ms: number
  frame_idx: number
  count: number
}

export interface PoseData {
  pitch_deg: number
  roll_deg: number
  yaw_deg: number
  alt_m: number
  vfov_deg: number
  source: 'drone' | 'estimated' | 'manual' | 'none'
  confidence: number
}

export interface WorldPointData {
  x_m: number
  y_m: number
  range_m: number
  bearing_deg: number
  lat: number | null
  lon: number | null
  source: 'drone' | 'estimated' | 'manual' | 'none'
  uncertainty_m: number
}

export interface FrameAnalysis {
  type: 'frame'
  frame_idx: number
  t_ms: number
  width: number
  height: number
  frame_jpeg_b64: string
  latency_ms: number
  detections: Detection[]
  count: number
  cluster: ClusterData | null
  selected: SelectedTrack | null
  centroid_trail: CentroidTrailEntry[]
  pose: PoseData
  world_centroid: WorldPointData | null
  world_selected: WorldPointData | null
}

export interface StreamInfo {
  type: 'info'
  info: VideoInfo
}

export type StreamMessage = FrameAnalysis | StreamInfo | { type: 'error'; error: string }
