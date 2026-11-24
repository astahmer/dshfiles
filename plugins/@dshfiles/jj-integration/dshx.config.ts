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
    'revision-graph': 'src/revision-graph.ts',
    // The repository-moved event the thread list and jj views refetch on (diffs-review lands through it too).
    'repository-change': 'src/repository-change.ts',
    // Sections other plugins add to the thread header's workspace menu (jujutsu's project-changes row).
    'workspace-menu-sections': 'src/workspace-menu-sections.ts',
    // Whether the thread header shows Land (diffs-review's land card then draws its Land as the secondary one).
    'thread-header-land': 'src/thread-header-land.ts',
  },
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/vcs-provider-port', '@dshfiles/jj-cli', '@dshfiles/git-cli'] },
  client: { entry: 'src/client.tsx', dshxRuntime: 'shared', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
