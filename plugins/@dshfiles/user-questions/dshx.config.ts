import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/user-questions',
  // The question form declares the token; @dshfiles/html-render provides the sandboxed renderer.
  modules: { 'html-preview': 'src/html-preview.ts' },
  host: { entry: 'src/host.ts' },
  client: {
    entry: 'src/client-entry.tsx',
    // Not browser-roster packages, so the native plugin's build inlines them too.
    bundleDependencies: ['@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-util-workspace-path'],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
