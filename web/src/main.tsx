import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// Surface unhandled errors into the boundary instead of a blank page
window.addEventListener('error', (e) => {
  console.error('[Skill Hub] window error:', e.error || e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Skill Hub] unhandled rejection:', e.reason)
})

const root = document.getElementById('root')
if (!root) {
  document.body.innerHTML =
    '<pre style="color:red;padding:24px;font-family:monospace">Skill Hub: #root not found in HTML</pre>'
} else {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}
