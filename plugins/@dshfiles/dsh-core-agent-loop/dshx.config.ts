import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/dsh-core-agent-loop',
  host: {
    entry: 'src/host.ts',
    /**
     * The fork's own dependencies are inlined rather than left external: a
     * profile does not hoist them, so an external import fails to resolve at
     * activation. Same set the core bridge inlines, for the same reason.
     */
    bundleDependencies: [
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-agent-loop',
      '@deepseek-ai/dsh-brand',
      '@deepseek-ai/dsh-scope',
      '@deepseek-ai/dsh-session-persistence',
      '@deepseek-ai/dsh-system-prompt',
      '@deepseek-ai/dsh-util-values',
    ],
  },
  profile: 'vanilla',
  build: { declarations: true },
})
