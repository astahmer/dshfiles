import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/diffs-review',
  modules: { 'review-page-context': 'src/review-page-context.ts' },
  host: {
    dshxRuntime: 'snapshot',
    entry: 'src/host.ts',
    bundleDependencies: ['@dshfiles/jj-cli', '@dshfiles/git-cli', '@dshfiles/vcs-provider-port', '@dshfiles/image-preview'],
  },
  client: { dshxRuntime: 'shared', shared: '@dshfiles/shared-runtime', entry: 'src/client.tsx', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
