import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/sidebar-right',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client-entry.tsx', bundleDependencies: ['@deepseek-ai/dsh-util-crypto'] },
  modules: { 'resource-panels': 'src/resource-panels.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
