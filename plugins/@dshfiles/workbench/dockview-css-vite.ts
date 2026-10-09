import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const MODULE_ID = 'virtual:dshfiles-workbench/dockview-css'
const RESOLVED_ID = `\0${MODULE_ID}`
const THEMES_START = '.dockview-theme-'

/**
 * Dockview ships one 150 KB sheet whose second half is ~20 bundled themes. Keep only the structural rules before the
 * first theme selector and append our token theme, as a string the client injects itself.
 */
export const dockviewCssVite = () => ({
  name: 'dshfiles-workbench-dockview-css',
  resolveId: (source: string): string | null => (source === MODULE_ID ? RESOLVED_ID : null),
  load: (id: string): string | null => {
    if (id !== RESOLVED_ID) return null
    const require = createRequire(import.meta.url)
    const full = readFileSync(require.resolve('dockview-react/dist/styles/dockview.css'), 'utf8')
    const themesStart = full.indexOf(THEMES_START)
    if (themesStart === -1) throw new Error(`dockview.css no longer contains ${THEMES_START} rules; re-check the structural cut`)
    const theme = readFileSync(new URL('./src/dockview-theme.css', import.meta.url), 'utf8')
    return `export default ${JSON.stringify(full.slice(0, themesStart) + theme)}`
  },
})
