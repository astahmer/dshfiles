import { fileURLToPath } from 'node:url'
import { StaticAssets } from '@dshfiles/dshx/effect'
import { EDITOR_ASSET_ROUTE, EDITOR_ENTRY_FILE } from './editor-route.js'

const contentTypes: ReadonlyMap<string, string> = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.map', 'application/json; charset=utf-8'],
])

/** Text assets worth compressing; fonts are already compressed woff2. */
const compressible: ReadonlySet<string> = new Set(['.js', '.css', '.map'])

/** The editor build output next to the Host bundle: `dist/editor/` beside `dist/index.js`. */
export const defaultEditorDirectory = (): string => fileURLToPath(new URL('./editor/', import.meta.url))

/**
 * The `node:http` handler for {@link EDITOR_ASSET_ROUTE}: the editor build, its chunks and the Excalidraw fonts, one
 * `whiteboard editor-asset serve` span per request. Chunks and fonts carry a content hash in their name; only the fixed
 * entry name must revalidate.
 */
export const createEditorAssetHandler = (input: { readonly directory: string; readonly run: StaticAssets.Runner }): StaticAssets.Handler =>
  StaticAssets.handler({
    route: EDITOR_ASSET_ROUTE,
    directory: input.directory,
    run: input.run,
    span: 'whiteboard editor-asset serve',
    plugin: 'whiteboard',
    contentTypes,
    compressible,
    cacheControl: name => (name === EDITOR_ENTRY_FILE ? 'no-cache' : 'public, max-age=31536000, immutable'),
  })
