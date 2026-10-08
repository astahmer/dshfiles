import tailwindcss from '@tailwindcss/vite'
import type { DshxViteExtensions } from '@dshfiles/dshx'

type DshxPluginOption = NonNullable<DshxViteExtensions['plugins']>[number]

/**
 * Client Vite plugins every plugin-ui consumer needs; call once per build (dshx rejects reused instances).
 * Typed with dshx's own `PluginOption`: the tooling and plugins workspaces install separate vite copies,
 * which TypeScript cannot unify structurally even at the same version.
 */
export const pluginUiVite = (): DshxPluginOption => tailwindcss() as unknown as DshxPluginOption
