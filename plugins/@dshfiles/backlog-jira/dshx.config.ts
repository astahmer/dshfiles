import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/backlog-jira',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/backlog', '@dshfiles/credential-port'] },
  build: { sourcemap: true, declarations: true },
})
