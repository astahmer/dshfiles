import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/user-questions',
  host: { entry: 'src/host.ts' },
  client: {
    entry: 'src/client-entry.tsx',
    // Not browser-roster packages, so the native plugin's build inlines them too.
    bundleDependencies: ['@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-session'],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
