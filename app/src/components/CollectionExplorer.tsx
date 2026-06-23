import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { CollectionImageEntry, CollectionSummary, DownloadProgress } from '../api/types'
import { useSelection } from '../state/selection'

const REGION_LABEL: Record<string, string> = {
  na: 'NA', me: 'ME', ea: 'EA', global: '·',
}
const DENSITY_LABEL: Record<string, string> = {
  urban: 'URB', rural: 'RUR', mixed: 'MIX',
}

export function CollectionExplorer() {
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [images, setImages] = useState<Record<string, CollectionImageEntry[]>>({})
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})
  const { collectionId, imageName, expanded, select, toggleExpanded, setView } = useSelection()

  const refresh = async () => {
    try {
      setCollections(await api.listCollections())
    } catch {
      /* sidecar not ready */
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    expanded.forEach(async (id) => {
      if (images[id]) return
      const list = await api.listImages(id)
      setImages((m) => ({ ...m, [id]: list }))
    })
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (id: string) => {
    setProgress((p) => ({ ...p, [id]: { collection_id: id, phase: 'download', current: 0, total: 0, message: '' } }))
    await api.downloadCollection(
      id,
      (e) => setProgress((p) => ({ ...p, [id]: e })),
      () => {
        refresh()
        api.listImages(id).then((list) => setImages((m) => ({ ...m, [id]: list })))
      },
    )
  }

  const academic = collections.filter((c) => c.kind === 'academic')
  const regional = collections.filter((c) => c.kind === 'regional')
  const user = collections.filter((c) => c.kind === 'user')

  return (
    <div className="h-full overflow-y-auto font-mono text-[11px] select-none">
      <Group title="FINE-TUNING BASE">
        {academic.map((c) => (
          <CollectionRow
            key={c.id} c={c}
            images={images[c.id]} progress={progress[c.id]}
            isExpanded={expanded.has(c.id)}
            isSelectedCollection={collectionId === c.id}
            selectedImage={collectionId === c.id ? imageName : null}
            onToggle={() => toggleExpanded(c.id)}
            onDownload={() => download(c.id)}
            onSelectImage={(name) => { select(c.id, name); setView('annotate') }}
          />
        ))}
      </Group>

      <Group title="REGIONS">
        {regional.map((c) => (
          <CollectionRow
            key={c.id} c={c}
            images={images[c.id]} progress={progress[c.id]}
            isExpanded={expanded.has(c.id)}
            isSelectedCollection={collectionId === c.id}
            selectedImage={collectionId === c.id ? imageName : null}
            onToggle={() => toggleExpanded(c.id)}
            onDownload={() => download(c.id)}
            onSelectImage={(name) => { select(c.id, name); setView('annotate') }}
          />
        ))}
      </Group>

      {user.length > 0 && (
        <Group title="MY IMPORTS">
          {user.map((c) => (
            <CollectionRow
              key={c.id} c={c}
              images={images[c.id]} progress={progress[c.id]}
              isExpanded={expanded.has(c.id)}
              isSelectedCollection={collectionId === c.id}
              selectedImage={collectionId === c.id ? imageName : null}
              onToggle={() => toggleExpanded(c.id)}
              onDownload={() => download(c.id)}
              onSelectImage={(name) => { select(c.id, name); setView('annotate') }}
            />
          ))}
        </Group>
      )}
    </div>
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
  c, images, progress, isExpanded, isSelectedCollection, selectedImage,
  onToggle, onDownload, onSelectImage,
}: {
  c: CollectionSummary
  images: CollectionImageEntry[] | undefined
  progress: DownloadProgress | undefined
  isExpanded: boolean
  isSelectedCollection: boolean
  selectedImage: string | null
  onToggle: () => void
  onDownload: () => void
  onSelectImage: (name: string) => void
}) {
  const downloaded = c.downloaded_count > 0
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null

  const noManifest = !downloaded && c.manifest_count === 0 && !c.archive_url
  const downloading = !!progress && progress.phase !== 'done' && progress.phase !== 'error'

  return (
    <div>
      <div
        className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 border-b"
        onClick={() => {
          if (downloaded) onToggle()
          else if (!noManifest && !downloading) onDownload()
        }}
        title={noManifest ? `${c.description} (no manifest seeded yet)` : c.description}
        style={{
          background: isSelectedCollection ? 'rgba(0,229,255,0.08)' : 'transparent',
          borderLeftWidth: 3,
          borderLeftStyle: 'solid',
          borderLeftColor: isSelectedCollection ? 'var(--color-accent)' : 'transparent',
          borderBottomColor: 'rgba(42,53,67,0.5)',
          opacity: noManifest ? 0.45 : 1,
        }}
      >
        <span className="w-3 inline-block text-center text-xs" style={{ color: 'var(--color-muted)' }}>
          {downloaded ? (isExpanded ? '▾' : '▸') : '·'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="truncate text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</div>
          <div className="font-mono text-[10px] mt-0.5 tracking-[0.1em]" style={{ color: 'var(--color-muted)' }}>
            {REGION_LABEL[c.region]} · {DENSITY_LABEL[c.density]}
          </div>
        </div>
        {downloaded ? (
          <span className="font-mono text-[11px] tabular-nums px-2 py-0.5" style={{ color: 'var(--color-accent)', background: 'rgba(0,229,255,0.1)' }}>
            {c.downloaded_count}
          </span>
        ) : noManifest ? (
          <span className="font-mono text-[10px] italic" style={{ color: 'var(--color-muted)' }}>
            empty
          </span>
        ) : (
          <button
            className="font-mono text-[11px] font-semibold px-2.5 py-1 border"
            style={{
              borderColor: downloading ? 'var(--color-warn)' : 'var(--color-accent)',
              color: downloading ? '#000' : '#000',
              background: downloading ? 'var(--color-warn)' : 'var(--color-accent)',
            }}
            onClick={(e) => {
              e.stopPropagation()
              onDownload()
            }}
            disabled={downloading}
          >
            {progress
              ? progress.phase === 'done'
                ? '✓'
                : progress.phase === 'error'
                  ? 'RETRY'
                  : pct !== null
                    ? `${pct}%`
                    : progress.phase.toUpperCase()
              : 'DOWNLOAD'}
          </button>
        )}
      </div>

      {isExpanded && images && (
        <div>
          {images.length === 0 ? (
            <div className="pl-8 py-1 italic text-[10px]" style={{ color: 'var(--color-muted)' }}>
              empty
            </div>
          ) : (
            images.map((img) => {
              const isSelected = isSelectedCollection && selectedImage === img.name
              return (
                <div
                  key={img.name}
                  className="flex items-center gap-2 pl-9 pr-3 py-1 cursor-pointer text-[11px] font-mono hover:bg-white/5"
                  style={{
                    background: isSelected ? 'rgba(0,229,255,0.12)' : 'transparent',
                    color: isSelected ? 'var(--color-accent)' : 'var(--color-text)',
                  }}
                  onClick={() => onSelectImage(img.name)}
                >
                  <span style={{ color: img.annotated ? 'var(--color-accent)' : 'var(--color-muted)' }}>
                    {img.annotated ? '●' : '○'}
                  </span>
                  <span className="flex-1 truncate">{img.name}</span>
                  {img.count !== null && (
                    <span className="tabular-nums" style={{ color: 'var(--color-muted)' }}>
                      {img.count}
                    </span>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
