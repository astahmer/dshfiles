import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/jj-integration',
  modules: {
    api: 'src/api.ts',
    settings: 'src/settings.ts',
    'merged-pull-requests': 'src/merged-pull-requests.ts',
    'no-folder': 'src/no-folder.ts',
    'project-bookmark': 'src/project-bookmark-query.ts',
    // Sections other plugins add under a revision's details in the jj panel (backlog backlinks).
    'revision-sections': 'src/revision-sections.ts',
  },
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/vcs-provider-port', '@dshfiles/jj-cli', '@dshfiles/git-cli'] },
  client: { entry: 'src/client.tsx', dshxRuntime: 'shared', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
