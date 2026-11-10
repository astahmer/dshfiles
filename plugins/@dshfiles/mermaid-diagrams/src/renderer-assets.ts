import { fileURLToPath } from 'node:url'
import { StaticAssets } from '@dshfiles/dshx/effect'
import { RENDERER_ROUTE } from './renderer-route.js'

const contentTypes: ReadonlyMap<string, string> = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
])

/** pele names its shared chunks by content hash (`chunks/DKUZGKB3.js`); entries keep fixed names and revalidate. */
const HASHED_CHUNK = /^chunks\/[A-Z0-9]{6,}\.js$/u

/** The renderer copy next to the Host bundle: `dist/renderer/` beside `dist/index.js`. */
export const defaultRendererDirectory = (): string => fileURLToPath(new URL('./renderer/', import.meta.url))

/** The `node:http` handler for {@link RENDERER_ROUTE}; one `mermaid-diagrams renderer-asset serve` span per request. */
export const createRendererAssetHandler = (input: { readonly directory: string; readonly run: StaticAssets.Runner }): StaticAssets.Handler =>
  StaticAssets.handler({
    route: RENDERER_ROUTE,
    directory: input.directory,
    run: input.run,
    span: 'mermaid-diagrams renderer-asset serve',
    plugin: 'mermaid-diagrams',
    contentTypes,
    compressible: new Set(contentTypes.keys()),
    cacheControl: name => (HASHED_CHUNK.test(name) ? 'public, max-age=31536000, immutable' : 'no-cache'),
  })
