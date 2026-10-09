import tailwindcss from '@tailwindcss/vite'
import type { DshxViteExtensions } from '@dshfiles/dshx'
import { fileURLToPath } from 'node:url'

type DshxPluginOption = NonNullable<DshxViteExtensions['plugins']>[number]

const SHIKI_SLIM = fileURLToPath(new URL('./shiki-slim.ts', import.meta.url))
const EMPTY_MODULE = '\0dshfiles-empty-module'
const USED_PIERRE_THEMES = new Set(['@pierre/theme/pierre-dark', '@pierre/theme/pierre-light'])

/**
 * Points `@pierre/diffs` at a curated grammar set instead of Shiki's full bundle (see `shiki-slim.ts`), and drops
 * the WASM engine and every theme except `pierre-light`/`pierre-dark`, which `PatchView` is the only one to pick.
 */
const slimShiki = {
  name: 'dshfiles-slim-shiki',
  enforce: 'pre',
  resolveId: (source: string, importer: string | undefined): string | null => {
    if (importer === undefined || !importer.includes('/@pierre/')) return null
    if (source === 'shiki') return SHIKI_SLIM
    if (source === 'shiki/wasm' || source.startsWith('@shikijs/themes/')) return EMPTY_MODULE
    if (source.startsWith('@pierre/theme/') && !USED_PIERRE_THEMES.has(source)) return EMPTY_MODULE
    return null
  },
  load: (id: string): string | null => (id === EMPTY_MODULE ? 'export default undefined' : null),
}

/**
 * Client Vite plugins every plugin-ui consumer needs; call once per build (dshx rejects reused instances).
 * Typed with dshx's own `PluginOption`: the tooling and plugins workspaces install separate vite copies,
 * which TypeScript cannot unify structurally even at the same version.
 */
export const pluginUiVite = (): DshxPluginOption => [tailwindcss(), { ...slimShiki }] as unknown as DshxPluginOption
