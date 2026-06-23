export type Region = 'na' | 'me' | 'ea' | 'global'
export type Density = 'urban' | 'rural' | 'mixed'
export type Kind = 'academic' | 'regional' | 'user'

export interface CollectionSummary {
  id: string
  name: string
  kind: Kind
  region: Region
  density: Density
  description: string
  pre_annotated: boolean
  download_size_bytes: number | null
  manifest_count: number
  downloaded_count: number
  annotated_count: number
  reviewed_count: number
}

export interface AutoAnnotateImageResult {
  image_name: string
  count: number
  image_size: [number, number]
}

export interface CollectionImageEntry {
  name: string
  annotated: boolean
  reviewed: boolean
  count: number | null
}

export interface Point {
  x: number
  y: number
  confidence: number
}

export interface InferResponse {
  points: Point[]
  peak_xy: [number, number]
  count: number
  image_size: [number, number]
}

export interface AnnotationPoint {
  x: number
  y: number
  confidence: number
  source: 'model' | 'user'
}

export interface Annotation {
  image_name: string
  points: AnnotationPoint[]
  image_size: [number, number]
  region: Region
  density: Density
  reviewed: boolean
}

export interface DownloadProgress {
  collection_id: string
  phase: 'download' | 'extract' | 'done' | 'error'
  current: number
  total: number
  message: string
}

export interface AutoAnnotateProgress {
  phase: 'inferring' | 'done' | 'error'
  current: number
  total: number
  image_name?: string
  count?: number
  annotated?: number
  skipped?: number
  message?: string
}
