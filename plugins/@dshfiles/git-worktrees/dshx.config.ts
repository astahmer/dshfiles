import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/git-worktrees',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/vcs-provider-port'] },
  build: { sourcemap: true, declarations: true },
})
