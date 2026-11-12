import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/cordis-client-runner',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  client: {
    entry: 'src/client-entry.tsx',
    dshxRuntime: 'shared',
    shared: '@dshfiles/shared-runtime',
    // The page does not provide the Timer plugin; the native runner instantiates TimerService on its own ctx and inlines it too.
    bundleDependencies: ['@deepseek-ai/cordis-plugin-timer'],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
