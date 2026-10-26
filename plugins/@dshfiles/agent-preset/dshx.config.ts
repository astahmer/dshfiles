import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/agent-preset',
  host: { entry: 'src/host.ts' },
  client: {
    entry: 'src/client-entry.tsx',
    // Plain helpers have no browser module-table entry in stock DSH.
    bundleDependencies: ['@deepseek-ai/dsh-util-values', '@deepseek-ai/dsh-agent-preset-registry'],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
