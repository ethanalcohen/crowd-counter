import { Topbar } from './components/Topbar'
import { CollectionExplorer } from './components/CollectionExplorer'
import { AnnotateView } from './views/AnnotateView'
import { LiveView } from './views/LiveView'
import { useSelection } from './state/selection'

function App() {
  const view = useSelection((s) => s.view)

  return (
    <div className="flex flex-col h-screen">
      <Topbar />
      <div className="flex flex-1 min-h-0">
        <aside
          className="w-72 border-r flex-shrink-0"
          style={{ borderColor: 'var(--color-line)', background: 'var(--color-panel)' }}
        >
          <CollectionExplorer />
        </aside>
        {view === 'annotate' ? <AnnotateView /> : <LiveView />}
      </div>
    </div>
  )
}

export default App
