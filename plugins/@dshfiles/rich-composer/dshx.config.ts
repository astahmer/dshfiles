import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/rich-composer',
  modules: {
    'conversation-contract': 'src/conversation-contract.ts',
  },
  client: {
    entry: 'src/client-entry.tsx',
    // Not browser-roster packages (no `dsh.client` row and no static seed name), so the
    // native plugin's tsdown build inlines them too; externalizing them would require a
    // module table entry that never exists.
    bundleDependencies: [
      '@deepseek-ai/dsh-api-workspace-controller',
      '@deepseek-ai/dsh-util-crypto',
      '@deepseek-ai/dsh-util-values',
      '@deepseek-ai/dsh-util-workspace-path',
    ],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
