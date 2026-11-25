import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/tool-search',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  // The per-agent tool access contract @dshfiles/agents provides (docs/plugin-boundaries.md).
  modules: { access: 'src/access.ts', 'tool-visibility': 'src/tool-visibility.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
