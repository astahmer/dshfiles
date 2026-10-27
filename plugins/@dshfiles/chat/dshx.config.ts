import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/chat',
  modules: {
    'turn-error-action': 'src/turn-error-action.ts',
    'chat-focus': 'src/chat-focus.ts',
    'turn-usage-cost': 'src/turn-usage-cost.ts',
  },
  client: {
    entry: 'src/client-entry.tsx',
    // Not browser-roster packages, so the native plugin's build inlines them too.
    bundleDependencies: [
      '@deepseek-ai/dsh-brand',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-token-meter',
      '@deepseek-ai/dsh-util-crypto',
      '@deepseek-ai/dsh-util-values',
      '@deepseek-ai/dsh-util-workspace-path',
      '@deepseek-ai/schemastery',
    ],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
