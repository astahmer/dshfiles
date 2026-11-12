import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'
import './styles.css'

// The kit's dark theme keys off the Host's body attribute; this page follows the system setting instead.
const scheme = window.matchMedia('(prefers-color-scheme: dark)')
const applyScheme = (): void => {
  document.body.toggleAttribute('data-ds-dark-theme', scheme.matches)
}
applyScheme()
scheme.addEventListener('change', applyScheme)

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
