import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/command-palette',
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  // Other plugins add palette rows and open the palette through this contract module.
  modules: { 'palette-contract': 'src/palette-contract.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
