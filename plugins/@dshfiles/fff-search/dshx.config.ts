import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/fff-search',
  host: { entry: 'src/host.ts' },
  // The index worker is a second entry: `dist/fff-worker.js` is the file the Host spawns.
  modules: { 'fff-worker': 'src/fff-worker.ts' },
  build: { sourcemap: true, declarations: true },
})
