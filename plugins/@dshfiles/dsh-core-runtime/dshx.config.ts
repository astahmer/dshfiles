import { copyFile, mkdir } from 'node:fs/promises'
import { defineConfig } from '@dshfiles/dshx'

const copySessionPersistenceVerifier = () => ({
  name: 'dsh-core-runtime-session-persistence-verifier',
  async closeBundle() {
    await mkdir(new URL('./dist/', import.meta.url), { recursive: true })
    await copyFile(
      new URL('./node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/worker.cjs', import.meta.url),
      new URL('./dist/worker.cjs', import.meta.url),
    )
  },
})

export default defineConfig({
  name: '@dshfiles/dsh-core-runtime',
  host: {
    entry: 'src/host.ts',
    bundleDependencies: [
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-agent-loop',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-session-persistence',
      '@deepseek-ai/dsh-session-persistence-jsonl',
      '@deepseek-ai/dsh-session-format-catalog',
      '@deepseek-ai/dsh-session-format-v4-to-v5',
    ],
    vite: { plugins: [copySessionPersistenceVerifier()] },
  },
  client: {
    entry: 'src/client.ts',
    bundleDependencies: [
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-typert-protocol',
      '@deepseek-ai/dsh-util-crypto',
      '@deepseek-ai/dsh-util-values',
      '@deepseek-ai/dsh-util-workspace-path',
    ],
  },
  profile: 'vanilla',
  build: { declarations: true },
})
