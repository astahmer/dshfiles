import type { DshxViteExtensions } from '@dshfiles/dshx'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

type DshxPluginOption = NonNullable<DshxViteExtensions['plugins']>[number]

const MONACO_ESM = '/node_modules/monaco-editor/esm/'
const MONACO_MIN_CSS = fileURLToPath(new URL('./node_modules/monaco-editor/min/vs/editor/editor.main.css', import.meta.url))
const MONACO_CSS_MODULE = 'virtual:dshfiles-monaco-css'
const RESOLVED_MONACO_CSS = '\0dshfiles-monaco-css'
const EMPTY_MODULE = '\0dshfiles-monaco-empty'
const BUNDLER_WORKER = /new Worker\(\s*new URL\([^)]*import\.meta\.url\)\s*,\s*\{[^}]*\}\s*\)/g
const BUNDLER_URL = /new URL\([^)]*import\.meta\.url\)/g

/**
 * Keeps Monaco inside the dshx single-chunk contract:
 * - its per-module `.css` imports would make this plugin's folded sheet differ from the shared plugin-ui sheet,
 *   so they resolve to nothing and the editor injects the prebuilt `editor.main.css` itself (fonts already inlined);
 * - its bundler-only `new Worker(new URL(…, import.meta.url))` fallbacks would emit worker chunks, so they become
 *   `undefined`: workers start from inlined `?worker&inline` sources through `MonacoEnvironment.getWorker` instead;
 * - Vite still emits each inlined worker's sourcemap as a standalone asset, which the contract forbids.
 */
// SAFETY: dshx and this workspace install separate vite copies whose plugin types cannot unify (as in plugin-ui vite.ts).
export const monacoSingleChunk = (): DshxPluginOption =>
  [
    {
      name: 'dshfiles-monaco-single-chunk',
      enforce: 'pre',
      resolveId: (source: string, importer: string | undefined): string | null => {
        if (source === MONACO_CSS_MODULE) return RESOLVED_MONACO_CSS
        if (importer !== undefined && importer.includes(MONACO_ESM) && source.endsWith('.css')) return EMPTY_MODULE
        return null
      },
      load: (id: string): string | null => {
        if (id === RESOLVED_MONACO_CSS) return `export default ${JSON.stringify(readFileSync(MONACO_MIN_CSS, 'utf8'))}`
        if (id === EMPTY_MODULE) return 'export {}'
        return null
      },
      transform: (code: string, id: string): string | null => {
        if (!id.includes(MONACO_ESM) || !code.includes('import.meta.url')) return null
        return code.replace(BUNDLER_WORKER, 'undefined').replace(BUNDLER_URL, 'undefined')
      },
    },
    {
      name: 'dshfiles-monaco-worker-sourcemaps',
      enforce: 'post',
      generateBundle: (_options: unknown, bundle: Record<string, { readonly type: string }>): void => {
        for (const fileName of Object.keys(bundle)) {
          if (/\.worker-[\w-]+\.js\.map$/.test(fileName)) Reflect.deleteProperty(bundle, fileName)
        }
      },
    },
  ] as unknown as DshxPluginOption
