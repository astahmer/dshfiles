import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/dsh-core-runtime',
  host: {
    entry: 'src/host.ts',
    bundleDependencies: [
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-agent-loop',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-session-persistence',
      '@deepseek-ai/dsh-session-persistence-jsonl',
      '@deepseek-ai/dsh-session-format-catalog',
      '@deepseek-ai/dsh-session-format-v4-to-v5',
      'zod',
    ],
  },
  profile: 'vanilla',
  build: { declarations: true },
})
