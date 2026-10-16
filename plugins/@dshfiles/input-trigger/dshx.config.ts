import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/input-trigger',
  profile: 'vanilla',
  client: {
    entry: 'src/client-entry.ts',
    bundleDependencies: ['@deepseek-ai/dsh-util-values'],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
