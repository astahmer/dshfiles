import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/schedule',
  host: { entry: 'src/host.ts' },
  client: {
    shared: '@dshfiles/shared-runtime',
    entry: 'src/client-entry.tsx',
    // Not browser-roster packages, so the native plugin's build inlines them too.
    bundleDependencies: ['@deepseek-ai/dsh-schedule', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-util-values'],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
