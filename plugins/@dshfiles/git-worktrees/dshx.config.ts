import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/git-worktrees',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/vcs-provider-port', '@dshfiles/git-cli'] },
  build: { sourcemap: true, declarations: true },
})
