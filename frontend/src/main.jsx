import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startReactScan } from './reactScan.js'

if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_REACT_SCAN === '1') {
  void startReactScan(true, () => import('react-scan'))
}

createRoot(document.getElementById('root')).render(
  <App />,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
