import { invoke } from '@tauri-apps/api/core'
import type {
  Annotation,
  AutoAnnotateImageResult,
  AutoAnnotateProgress,
  CollectionImageEntry,
  CollectionSummary,
  DownloadProgress,
  InferResponse,
} from './types'

let cachedPort: number | null = null

async function port(): Promise<number> {
  if (cachedPort !== null) return cachedPort
  try {
    cachedPort = await invoke<number>('sidecar_port')
  } catch {
    cachedPort = 17893
  }
  return cachedPort
}

async function base(): Promise<string> {
  return `http://127.0.0.1:${await port()}`
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${await base()}${path}`)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<T>
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${await base()}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${await base()}${path}`, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<T>
}

export const api = {
  health: () =>
    get<{ status: string; model_loaded: boolean; weights_source: string | null; device: string | null }>('/health'),
  loadModel: () =>
    post<{ loaded: boolean; weights_source: string | null; device: string | null }>('/model/load'),

  listCollections: () => get<CollectionSummary[]>('/collections'),
  getCollection: (id: string) => get<CollectionSummary>(`/collections/${id}`),
  listImages: (id: string, status?: 'annotated' | 'unannotated') =>
    get<CollectionImageEntry[]>(`/collections/${id}/images${status ? `?status=${status}` : ''}`),
  imageUrl: async (id: string, name: string) =>
    `${await base()}/collections/${id}/images/${encodeURIComponent(name)}`,

  getAnnotation: async (id: string, name: string): Promise<Annotation | null> => {
    const r = await fetch(`${await base()}/collections/${id}/annotations/${encodeURIComponent(name)}`)
    if (r.status === 204) return null
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json() as Promise<Annotation>
  },
  putAnnotation: (
    id: string,
    name: string,
    body: { points: Array<{ x: number; y: number; confidence: number; source: 'model' | 'user' }>; image_size: [number, number]; reviewed: boolean },
  ) => put<{ saved: string; count: number }>(`/collections/${id}/annotations/${encodeURIComponent(name)}`, body),

  inferCollectionImage: (id: string, name: string) =>
    post<InferResponse>(`/collections/${id}/infer/${encodeURIComponent(name)}`),

  autoAnnotateImage: (id: string, name: string) =>
    post<AutoAnnotateImageResult>(`/collections/${id}/auto-annotate/${encodeURIComponent(name)}`),

  downloadCollection: async (
    id: string,
    onProgress: (e: DownloadProgress) => void,
    onClose?: () => void,
  ): Promise<WebSocket> => {
    const ws = new WebSocket(`ws://127.0.0.1:${await port()}/collections/${id}/download`)
    ws.onmessage = (ev) => {
      try {
        onProgress(JSON.parse(ev.data) as DownloadProgress)
      } catch {
        /* ignore */
      }
    }
    ws.onclose = () => onClose?.()
    return ws
  },

  autoAnnotate: async (
    id: string,
    onProgress: (e: AutoAnnotateProgress) => void,
    onClose?: () => void,
  ): Promise<WebSocket> => {
    const ws = new WebSocket(`ws://127.0.0.1:${await port()}/collections/${id}/auto-annotate`)
    ws.onmessage = (ev) => {
      try {
        onProgress(JSON.parse(ev.data) as AutoAnnotateProgress)
      } catch {
        /* ignore */
      }
    }
    ws.onclose = () => onClose?.()
    return ws
  },
}
