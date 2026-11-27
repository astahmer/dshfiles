import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/tool-subagent',
  host: { dshxRuntime: 'snapshot', entry: 'src/native/index.ts' },
  // The contract an agent registry (@dshfiles/agents) provides for the `agent` argument (docs/plugin-boundaries.md).
  modules: { 'agent-resolver': 'src/agent-resolver.ts' },
  build: { sourcemap: true, declarations: true, minify: false },
})
