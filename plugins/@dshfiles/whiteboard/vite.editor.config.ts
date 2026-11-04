import { cpSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { EDITOR_ENTRY_FILE, EDITOR_RUNTIME_GLOBAL, EDITOR_RUNTIME_MODULES, type EditorRuntimeModule } from './src/editor-route.js'

/**
 * Builds the Excalidraw editor as its own ES module graph in `dist/editor/`, served by the Host route in
 * `src/editor-assets.ts` and imported by the Client only when a board opens. dshx Client builds are a single
 * chunk every page downloads at boot, so the multi-megabyte editor (and Mermaid, imported on first conversion)
 * cannot live in `client.js`.
 */
const root = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const virtualPrefix = '\0dshfiles-whiteboard-runtime:'
const identifier = /^[A-Za-z_$][\w$]*$/u

/**
 * React must be the Host page's copy (one React per page, or hooks break), so `react`, `react-dom` and their
 * subpaths resolve to modules that re-export what the Client left on {@link EDITOR_RUNTIME_GLOBAL}. The export
 * names come from the installed React, so the shim cannot drift from the version the Host serves.
 */
const hostReact = (): Plugin => ({
  name: 'dshfiles-whiteboard-host-react',
  enforce: 'pre',
  resolveId(source) {
    return EDITOR_RUNTIME_MODULES.some(module => module === source) ? `${virtualPrefix}${source}` : null
  },
  load(id) {
    if (!id.startsWith(virtualPrefix)) return null
    // SAFETY: resolveId only produces this prefix for the listed runtime modules.
    const module = id.slice(virtualPrefix.length) as EditorRuntimeModule
    // SAFETY: each listed runtime module is a CommonJS package whose export is a plain object of named bindings.
    const names = Object.keys(require(module) as object).filter(name => name !== 'default' && identifier.test(name))
    const binding = `globalThis[${JSON.stringify(EDITOR_RUNTIME_GLOBAL)}][${JSON.stringify(module)}]`
    return [`const m = ${binding};`, 'export default m;', ...names.map(name => `export const ${name} = m.${name};`)].join('\n')
  },
})

/** Excalidraw fetches its fonts from `EXCALIDRAW_ASSET_PATH`; ship them beside the bundle instead of a CDN. */
const excalidrawFonts = (): Plugin => ({
  name: 'dshfiles-whiteboard-excalidraw-fonts',
  apply: 'build',
  writeBundle(options) {
    const outDir = options.dir ?? join(root, 'dist/editor')
    const fonts = join(dirname(require.resolve('@excalidraw/excalidraw')), 'fonts')
    if (!existsSync(fonts)) throw new Error(`Excalidraw fonts not found at ${fonts}; reinstall @excalidraw/excalidraw.`)
    cpSync(fonts, join(outDir, 'fonts'), { recursive: true })
  },
})

export default defineConfig({
  root,
  publicDir: false,
  logLevel: 'warn',
  mode: 'production',
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env.IS_PREACT': JSON.stringify('false') },
  plugins: [hostReact(), excalidrawFonts()],
  build: {
    outDir: 'dist/editor',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4096,
    lib: { entry: join(root, 'src/editor/entry.tsx'), formats: ['es'], fileName: () => EDITOR_ENTRY_FILE },
    minify: true,
    rolldownOptions: {
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
      // Radix and other dependencies mark modules "use client"; that directive is meaningless in this browser-only bundle.
      onLog: (level, log, handler) => (log.code === 'MODULE_LEVEL_DIRECTIVE' ? undefined : handler(level, log)),
    },
  },
})
