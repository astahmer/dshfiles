import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/input-trigger',
  profile: 'vanilla',
  client: {
    entry: 'src/client-entry.ts',
    bundleDependencies: ['@deepseek-ai/dsh-util-values'],
  },
  // Backlog's plain text boxes resolve @ and # tokens with the same Codex rules as the rich composer.
  modules: { 'caret-token': 'src/caret-token.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
