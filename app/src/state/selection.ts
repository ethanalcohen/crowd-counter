import { create } from 'zustand'

export type ViewMode = 'annotate' | 'live'

interface SelectionState {
  collectionId: string | null
  imageName: string | null
  expanded: Set<string>
  view: ViewMode
  refreshKey: number
  select: (collectionId: string | null, imageName: string | null) => void
  toggleExpanded: (collectionId: string) => void
  setView: (view: ViewMode) => void
  triggerRefresh: () => void
}

export const useSelection = create<SelectionState>((set) => ({
  collectionId: null,
  imageName: null,
  expanded: new Set<string>(),
  view: 'annotate',
  refreshKey: 0,
  select: (collectionId, imageName) => set({ collectionId, imageName }),
  toggleExpanded: (collectionId) =>
    set((s) => {
      const next = new Set(s.expanded)
      if (next.has(collectionId)) next.delete(collectionId)
      else next.add(collectionId)
      return { expanded: next }
    }),
  setView: (view) => set({ view }),
  triggerRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}))
