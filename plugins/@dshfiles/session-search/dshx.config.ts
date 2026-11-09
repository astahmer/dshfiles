import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/session-search',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/session-log-window'] },
  // The index worker is a second entry: `dist/search-worker.js` is the file the Host spawns, and the matching export
  // subpath is what makes it reachable after a build.
  modules: { 'search-worker': 'src/search-worker.ts' },
  build: { sourcemap: true, declarations: true },
})
