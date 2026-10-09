import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'
import { dockviewCssVite } from './dockview-css-vite.ts'

export default defineConfig({
  name: '@dshfiles/workbench',
  client: { entry: 'src/client.tsx', vite: { plugins: [pluginUiVite(), dockviewCssVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
