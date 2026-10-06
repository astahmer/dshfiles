import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/dsh-core-runtime',
  host: {
    entry: 'src/host.ts',
    bundleDependencies: ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-session'],
  },
  profile: 'vanilla',
  build: { declarations: true },
})
