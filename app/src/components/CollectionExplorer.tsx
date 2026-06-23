import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AutoAnnotateProgress, CollectionImageEntry, CollectionSummary, DownloadProgress } from '../api/types'
import { useSelection } from '../state/selection'

const REGION_LABEL: Record<string, string> = {
  na: 'NA', me: 'ME', ea: 'EA', global: '·',
}
const DENSITY_LABEL: Record<string, string> = {
  urban: 'URB', rural: 'RUR', mixed: 'MIX',
}

export function CollectionExplorer() {
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(true)
  const [images, setImages] = useState<Record<string, CollectionImageEntry[]>>({})
  const [loadedAll, setLoadedAll] = useState<Set<string>>(new Set())
  const [loadingList, setLoadingList] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})
  const [autoProgress, setAutoProgress] = useState<Record<string, AutoAnnotateProgress>>({})
  const [annotatingImages, setAnnotatingImages] = useState<Set<string>>(new Set())
  const { collectionId, imageName, expanded, refreshKey, select, toggleExpanded, setView } = useSelection()

  const refresh = async () => {
    try {
      const result = await api.listCollections()
      setCollections(result)
      setCollectionsLoading(false)
    } catch {
      /* sidecar not ready */
    }
  }

  const loadAnnotatedImages = async (id: string) => {
    setLoadingList((s) => new Set(s).add(id))
    try {
      const list = await api.listImages(id, 'annotated')
      setImages((m) => ({ ...m, [id]: list }))
    } finally {
      setLoadingList((s) => { const n = new Set(s); n.delete(id); return n })
    }
  }

  const loadAllImages = async (id: string) => {
    setLoadingList((s) => new Set(s).add(id))
    try {
      const list = await api.listImages(id)
      setImages((m) => ({ ...m, [id]: list }))
      setLoadedAll((s) => new Set(s).add(id))
    } finally {
      setLoadingList((s) => { const n = new Set(s); n.delete(id); return n })
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    expanded.forEach((id) => {
      if (images[id]) return
      loadAnnotatedImages(id)
    })
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (refreshKey === 0) return
    expanded.forEach((id) => {
      if (loadedAll.has(id)) {
        loadAllImages(id)
      } else {
        loadAnnotatedImages(id)
      }
    })
    refresh()
  }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (id: string) => {
    setProgress((p) => ({ ...p, [id]: { collection_id: id, phase: 'download', current: 0, total: 0, message: '' } }))
    await api.downloadCollection(
      id,
      (e) => setProgress((p) => ({ ...p, [id]: e })),
      () => {
        refresh()
        loadAnnotatedImages(id)
      },
    )
  }

  const autoAnnotate = async (id: string) => {
    setAutoProgress((p) => ({ ...p, [id]: { phase: 'inferring', current: 0, total: 0 } }))
    await api.autoAnnotate(
      id,
      (e) => setAutoProgress((p) => ({ ...p, [id]: e })),
      () => {
        refresh()
        if (loadedAll.has(id)) {
          loadAllImages(id)
        } else {
          loadAnnotatedImages(id)
        }
        setAutoProgress((p) => {
          const next = { ...p }
          if (next[id]?.phase === 'done') {
            setTimeout(() => setAutoProgress((pp) => { const n = { ...pp }; delete n[id]; return n }), 3000)
          }
          return next
        })
      },
    )
  }

  const autoAnnotateOne = async (colId: string, imgName: string) => {
    const key = `${colId}/${imgName}`
    setAnnotatingImages((s) => new Set(s).add(key))
    try {
      const result = await api.autoAnnotateImage(colId, imgName)
      setImages((m) => {
        const list = m[colId]
        if (!list) return m
        return {
          ...m,
          [colId]: list.map((img) =>
            img.name === imgName
              ? { ...img, annotated: true, reviewed: false, count: result.count }
              : img,
          ),
        }
      })
      refresh()
    } finally {
      setAnnotatingImages((s) => { const n = new Set(s); n.delete(key); return n })
    }
  }

  const academic = collections.filter((c) => c.kind === 'academic')
  const regional = collections.filter((c) => c.kind === 'regional')
  const user = collections.filter((c) => c.kind === 'user')

  return (
    <div className="h-full overflow-y-auto font-mono text-[11px] select-none">
      {collectionsLoading && collections.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-6" style={{ color: 'var(--color-muted)' }}>
          <Spinner />
          <span className="text-[10px] tracking-[0.15em]">LOADING COLLECTIONS…</span>
        </div>
      )}

      {collections.length > 0 && (
        <>
          <Group title="FINE-TUNING BASE">
            {academic.map((c) => (
              <CollectionRow
                key={c.id} c={c}
                images={images[c.id]}
                hasLoadedAll={loadedAll.has(c.id)}
                isLoadingList={loadingList.has(c.id)}
                annotatingImages={annotatingImages}
                progress={progress[c.id]}
                autoProgress={autoProgress[c.id]}
                isExpanded={expanded.has(c.id)}
                isSelectedCollection={collectionId === c.id}
                selectedImage={collectionId === c.id ? imageName : null}
                onToggle={() => toggleExpanded(c.id)}
                onDownload={() => download(c.id)}
                onAutoAnnotate={() => autoAnnotate(c.id)}
                onAutoAnnotateOne={(name) => autoAnnotateOne(c.id, name)}
                onLoadAll={() => loadAllImages(c.id)}
                onSelectImage={(name) => { select(c.id, name); setView('annotate') }}
              />
            ))}
          </Group>

          <Group title="REGIONS">
            {regional.map((c) => (
              <CollectionRow
                key={c.id} c={c}
                images={images[c.id]}
                hasLoadedAll={loadedAll.has(c.id)}
                isLoadingList={loadingList.has(c.id)}
                annotatingImages={annotatingImages}
                progress={progress[c.id]}
                autoProgress={autoProgress[c.id]}
                isExpanded={expanded.has(c.id)}
                isSelectedCollection={collectionId === c.id}
                selectedImage={collectionId === c.id ? imageName : null}
                onToggle={() => toggleExpanded(c.id)}
                onDownload={() => download(c.id)}
                onAutoAnnotate={() => autoAnnotate(c.id)}
                onAutoAnnotateOne={(name) => autoAnnotateOne(c.id, name)}
                onLoadAll={() => loadAllImages(c.id)}
                onSelectImage={(name) => { select(c.id, name); setView('annotate') }}
              />
            ))}
          </Group>

          {user.length > 0 && (
            <Group title="MY IMPORTS">
              {user.map((c) => (
                <CollectionRow
                  key={c.id} c={c}
                  images={images[c.id]}
                  hasLoadedAll={loadedAll.has(c.id)}
                  isLoadingList={loadingList.has(c.id)}
                  annotatingImages={annotatingImages}
                  progress={progress[c.id]}
                  autoProgress={autoProgress[c.id]}
                  isExpanded={expanded.has(c.id)}
                  isSelectedCollection={collectionId === c.id}
                  selectedImage={collectionId === c.id ? imageName : null}
                  onToggle={() => toggleExpanded(c.id)}
                  onDownload={() => download(c.id)}
                  onAutoAnnotate={() => autoAnnotate(c.id)}
                  onAutoAnnotateOne={(name) => autoAnnotateOne(c.id, name)}
                  onLoadAll={() => loadAllImages(c.id)}
                  onSelectImage={(name) => { select(c.id, name); setView('annotate') }}
                />
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block w-3 h-3 border-2 border-t-transparent rounded-full"
      style={{
        borderColor: 'var(--color-accent)',
        borderTopColor: 'transparent',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] border-b border-t"
        style={{
          color: 'var(--color-accent)',
          borderColor: 'var(--color-line)',
          background: 'var(--color-panel-2)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function CollectionRow({
  c, images, hasLoadedAll, isLoadingList, annotatingImages,
  progress, autoProgress, isExpanded, isSelectedCollection, selectedImage,
  onToggle, onDownload, onAutoAnnotate, onAutoAnnotateOne, onLoadAll, onSelectImage,
}: {
  c: CollectionSummary
  images: CollectionImageEntry[] | undefined
  hasLoadedAll: boolean
  isLoadingList: boolean
  annotatingImages: Set<string>
  progress: DownloadProgress | undefined
  autoProgress: AutoAnnotateProgress | undefined
  isExpanded: boolean
  isSelectedCollection: boolean
  selectedImage: string | null
  onToggle: () => void
  onDownload: () => void
  onAutoAnnotate: () => void
  onAutoAnnotateOne: (name: string) => void
  onLoadAll: () => void
  onSelectImage: (name: string) => void
}) {
  const downloaded = c.downloaded_count > 0
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null

  const noManifest = !downloaded && c.manifest_count === 0 && !c.archive_url
  const downloading = !!progress && progress.phase !== 'done' && progress.phase !== 'error'
  const errored = progress?.phase === 'error'
  const sizeMB = c.download_size_bytes ? (c.download_size_bytes / (1024 * 1024)).toFixed(0) : null

  const autoRunning = !!autoProgress && autoProgress.phase === 'inferring'
  const autoError = autoProgress?.phase === 'error'
  const autoDone = autoProgress?.phase === 'done'
  const autoPct = autoProgress && autoProgress.total > 0 ? Math.round((autoProgress.current / autoProgress.total) * 100) : null

  const unannotatedCount = c.downloaded_count - c.annotated_count
  const hasUnreviewed = downloaded && c.reviewed_count < c.downloaded_count

  return (
    <div className="border-b" style={{ borderColor: 'rgba(42,53,67,0.5)' }}>
      <div
        className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5"
        onClick={() => {
          if (downloaded) onToggle()
        }}
        title={c.description}
        style={{
          background: isSelectedCollection ? 'rgba(0,229,255,0.08)' : 'transparent',
          borderLeftWidth: 3,
          borderLeftStyle: 'solid',
          borderLeftColor: isSelectedCollection ? 'var(--color-accent)' : 'transparent',
          opacity: noManifest ? 0.55 : 1,
        }}
      >
        <span className="w-3 inline-block text-center text-xs" style={{ color: 'var(--color-muted)' }}>
          {downloaded ? (isExpanded ? '▾' : '▸') : '·'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="truncate text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</div>
          <div className="font-mono text-[10px] mt-0.5 tracking-[0.1em]" style={{ color: 'var(--color-muted)' }}>
            {REGION_LABEL[c.region]} · {DENSITY_LABEL[c.density]}
            {sizeMB && !downloaded ? ` · ${sizeMB} MB` : ''}
          </div>
        </div>
        {downloaded && (
          <span className="font-mono text-[11px] tabular-nums px-2 py-0.5" style={{ color: 'var(--color-accent)', background: 'rgba(0,229,255,0.1)' }}>
            {c.downloaded_count}
          </span>
        )}
      </div>

      {!downloaded && !noManifest && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (!downloading) onDownload()
          }}
          disabled={downloading}
          className="w-full font-mono text-[11px] font-semibold tracking-[0.15em] py-2 mt-0 mb-0 border-t"
          style={{
            background: errored ? 'var(--color-bad)' : downloading ? 'var(--color-warn)' : 'var(--color-accent)',
            color: '#000',
            borderColor: 'var(--color-line)',
          }}
        >
          {progress
            ? progress.phase === 'done'
              ? '✓ DOWNLOADED'
              : progress.phase === 'error'
                ? 'RETRY DOWNLOAD'
                : pct !== null
                  ? `${progress.phase.toUpperCase()} · ${pct}%`
                  : progress.phase.toUpperCase()
            : `↓ DOWNLOAD ARCHIVE${sizeMB ? ` · ${sizeMB} MB` : ''}`}
        </button>
      )}

      {downloaded && hasUnreviewed && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (!autoRunning) onAutoAnnotate()
          }}
          disabled={autoRunning}
          className="w-full font-mono text-[11px] font-semibold tracking-[0.15em] py-2 mt-0 mb-0 border-t"
          style={{
            background: autoError ? 'var(--color-bad)' : autoRunning ? 'var(--color-warn)' : autoDone ? 'rgba(34,197,94,0.15)' : 'rgba(0,229,255,0.12)',
            color: autoError ? '#fff' : autoRunning ? '#000' : autoDone ? 'var(--color-ok)' : 'var(--color-accent)',
            borderColor: 'var(--color-line)',
          }}
        >
          {autoProgress
            ? autoProgress.phase === 'done'
              ? `✓ ${autoProgress.annotated ?? 0} IMAGES PREDICTED`
              : autoProgress.phase === 'error'
                ? 'AUTO-ANNOTATE FAILED'
                : autoPct !== null
                  ? `INFERRING · ${autoPct}%`
                  : 'STARTING…'
            : '⚡ AUTO-ANNOTATE ALL'}
        </button>
      )}

      {autoError && autoProgress?.message && (
        <div
          className="font-mono text-[10px] px-3 py-1.5 truncate"
          style={{ color: 'var(--color-bad)', background: 'rgba(239,68,68,0.08)' }}
          title={autoProgress.message}
        >
          {autoProgress.message}
        </div>
      )}

      {autoRunning && autoProgress?.image_name && (
        <div
          className="font-mono text-[10px] px-3 py-1.5 truncate"
          style={{ color: 'var(--color-muted)' }}
        >
          {autoProgress.image_name} → {autoProgress.count ?? '…'} pts
        </div>
      )}

      {!downloaded && noManifest && (
        <div className="font-mono text-[10px] px-3 pb-2 italic" style={{ color: 'var(--color-muted)' }}>
          no images seeded yet — coming soon
        </div>
      )}

      {(downloading || errored) && progress?.message && (
        <div
          className="font-mono text-[10px] px-3 py-1.5 truncate"
          style={{
            color: errored ? 'var(--color-bad)' : 'var(--color-muted)',
            background: errored ? 'rgba(239,68,68,0.08)' : 'transparent',
          }}
          title={progress.message}
        >
          {errored ? `error: ${progress.message}` : progress.message}
        </div>
      )}

      {isExpanded && (
        <div>
          {isLoadingList && !images && (
            <div className="flex items-center gap-2 pl-9 py-2" style={{ color: 'var(--color-muted)' }}>
              <Spinner />
              <span className="text-[10px] tracking-[0.1em]">LOADING…</span>
            </div>
          )}
          {images && images.length === 0 && !isLoadingList && (
            <div className="pl-8 py-1 italic text-[10px]" style={{ color: 'var(--color-muted)' }}>
              {hasLoadedAll ? 'empty' : 'no annotated images yet'}
            </div>
          )}
          {images && images.map((img) => {
            const isSelected = isSelectedCollection && selectedImage === img.name
            const statusIcon = img.reviewed ? '●' : img.annotated ? '◐' : '○'
            const statusColor = img.reviewed ? 'var(--color-ok)' : img.annotated ? 'var(--color-warn)' : 'var(--color-muted)'
            const imgKey = `${c.id}/${img.name}`
            const isAnnotating = annotatingImages.has(imgKey)
            return (
              <div
                key={img.name}
                className="flex items-center gap-2 pl-9 pr-3 py-1 cursor-pointer text-[11px] font-mono hover:bg-white/5"
                style={{
                  background: isSelected ? 'rgba(0,229,255,0.12)' : 'transparent',
                  color: isSelected ? 'var(--color-accent)' : 'var(--color-text)',
                }}
                onClick={() => onSelectImage(img.name)}
                title={img.reviewed ? 'Reviewed' : img.annotated ? 'Predicted — needs review' : 'No annotation'}
              >
                {isAnnotating
                  ? <Spinner />
                  : <span style={{ color: statusColor }}>{statusIcon}</span>
                }
                <span className="flex-1 truncate">{img.name}</span>
                {!img.annotated && !isAnnotating && (
                  <button
                    className="px-1.5 py-0.5 text-[10px] hover:bg-white/10"
                    style={{ color: 'var(--color-accent)' }}
                    onClick={(e) => { e.stopPropagation(); onAutoAnnotateOne(img.name) }}
                    title="Auto-annotate this image"
                  >
                    ⚡
                  </button>
                )}
                {img.count !== null && (
                  <span className="tabular-nums" style={{ color: 'var(--color-muted)' }}>
                    {img.count}
                  </span>
                )}
              </div>
            )
          })}

          {images && !hasLoadedAll && unannotatedCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onLoadAll() }}
              disabled={isLoadingList}
              className="w-full flex items-center justify-center gap-2 py-2 font-mono text-[10px] tracking-[0.1em] hover:bg-white/5 border-t"
              style={{
                color: 'var(--color-accent)',
                borderColor: 'rgba(42,53,67,0.5)',
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid rgba(42,53,67,0.5)',
              }}
            >
              {isLoadingList
                ? <><Spinner /> LOADING…</>
                : `↓ LOAD ${unannotatedCount} UNANNOTATED IMAGE${unannotatedCount !== 1 ? 'S' : ''}`
              }
            </button>
          )}
        </div>
      )}
    </div>
  )
}
