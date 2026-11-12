import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/rich-composer',
  modules: {
    'conversation-contract': 'src/conversation-contract.ts',
    'thread-views': 'src/thread-views.ts',
    'composer-more': 'src/composer-more.ts',
    'phone-thread-menu': 'src/phone-thread-menu.tsx',
    'rich-text-editor': 'src/editor/index.ts',
  },
  client: {
    dshxRuntime: 'shared',
    shared: '@dshfiles/shared-runtime',
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
