import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/sidebar-terminal',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  client: { dshxRuntime: 'shared', shared: '@dshfiles/shared-runtime', entry: 'src/client-entry.ts', bundleDependencies: ['@xterm/xterm', '@xterm/addon-fit'] },
  build: { sourcemap: true, declarations: true, minify: true },
})
