import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/deliverables',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/image-preview'] },
  client: {
    dshxRuntime: 'shared',
    shared: '@dshfiles/shared-runtime',
    entry: 'src/client-entry.tsx',
    // Not browser-roster packages, so the native plugin's build inlines them too.
    bundleDependencies: ['@deepseek-ai/dsh-session', '@deepseek-ai/dsh-util-workspace-path'],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
