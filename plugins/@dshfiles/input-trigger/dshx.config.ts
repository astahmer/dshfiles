import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/input-trigger',
  profile: 'vanilla',
  client: {
    entry: 'src/client-entry.ts',
    shared: '@dshfiles/shared-runtime',
    bundleDependencies: ['@deepseek-ai/dsh-util-values'],
    vite: { plugins: [pluginUiVite()] },
  },
  // Backlog's plain text boxes resolve @ and # tokens with the same Codex rules as the rich composer.
  // The entity registry is the one `@` and reference-preview registry every mentionable kind provides into.
  modules: {
    'caret-token': 'src/caret-token.ts',
    'entity-registry': 'src/entity-registry.ts',
    'entity-reference': 'src/entity-reference.tsx',
    'image-attachment-contract': 'src/image-attachment-contract.ts',
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
