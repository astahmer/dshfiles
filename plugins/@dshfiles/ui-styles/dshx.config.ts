import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

/**
 * Owner of the shared plugin-ui stylesheet and of the theme. `src/client.css` imports `@dshfiles/plugin-ui/styles.css`,
 * whose `@source '../..'` scans every owned plugin, so this one build compiles the union sheet that every other UI
 * plugin used to compile for itself. The Host half (`src/host.ts`) owns the Appearance settings and the theme agent
 * tools; the Client applies them over the static first-paint theme.
 */
export default defineConfig({
  name: '@dshfiles/ui-styles',
  host: { entry: 'src/host.ts' },
  client: {
    entry: 'src/client.ts',
    dshxRuntime: 'shared',
    shared: '@dshfiles/shared-runtime',
    vite: { plugins: [pluginUiVite()] },
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
