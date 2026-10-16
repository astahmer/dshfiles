import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

/**
 * Client-only owner of the shared plugin-ui stylesheet. `src/client.css` imports `@dshfiles/plugin-ui/styles.css`,
 * whose `@source '../..'` scans every owned plugin, so this one build compiles the union sheet that every other UI
 * plugin used to compile for itself.
 */
export default defineConfig({
  name: '@dshfiles/ui-styles',
  host: false,
  client: {
    entry: 'src/client.ts',
    vite: { plugins: [pluginUiVite()] },
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
