import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode disabled in dev because the double-mount makes our health/collections
// polling effects fire twice (visible in the sidecar logs) and stutters the canvas.
createRoot(document.getElementById('root')!).render(<App />)
