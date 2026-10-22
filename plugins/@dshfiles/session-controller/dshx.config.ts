import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/session-controller',
  modules: { 'interruption-api': 'src/interruption-api.ts', 'continuation-api': 'src/continuation-api.ts' },
  // tsc lowers the Host's TC39 `@Remote` decorators first, as the native build does; the bundler keeps them as is.
  host: { entry: 'build/host/host.js' },
  client: {
    entry: 'src/client-entry.tsx',
    // The native build inlines these into its client chunk; they are not browser-roster modules.
    bundleDependencies: [
      '@deepseek-ai/dsh-brand',
      '@deepseek-ai/dsh-deque',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-typert-protocol',
      '@deepseek-ai/dsh-util-crypto',
      '@deepseek-ai/dsh-util-values',
      '@deepseek-ai/dsh-util-workspace-path',
    ],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
