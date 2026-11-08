import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/workspace-folder-picker',
  modules: {
    'directory-browser-api': 'src/directory-browser-api.ts',
    'project-lifecycle-api': 'src/project-lifecycle-api.ts',
    'project-folder-setup': 'src/project-folder-setup.tsx',
    picker: 'src/picker/index.ts',
    'project-icon-view': 'src/project-icon-view.tsx',
    'project-config': 'src/project-config.ts',
    'repository-setup-contract': 'src/repository-setup-contract.ts',
  },
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', vite: { plugins: [pluginUiVite()] } },
  build: {
    sourcemap: true,
    declarations: true,
    minify: true,
  },
})
