import { defineConfig } from '@dshfiles/dshx'

// dsh-util-time default-imports rrule as Node does (CommonJS `main`); the browser build would pick rrule's ESM `module`
// entry, which has no default export.
const rruleCommonJs = {
  name: 'dshfiles-schedule-rrule-commonjs',
  config: () => ({ resolve: { alias: [{ find: /^rrule$/, replacement: 'rrule/dist/es5/rrule.js' }] } }),
}

export default defineConfig({
  name: '@dshfiles/schedule',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  client: {
    dshxRuntime: 'shared',
    shared: '@dshfiles/shared-runtime',
    entry: 'src/client-entry.tsx',
    vite: { plugins: [rruleCommonJs] },
    // Not browser-roster packages, so the native plugin's build inlines them too. The workspace controller root stays
    // injected; only its pure `default-workspace` leaf, which has no module-table row, is inlined (dshx accepts roots only).
    bundleDependencies: [
      '@deepseek-ai/dsh-api-workspace-controller',
      '@deepseek-ai/dsh-schedule',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-util-time',
      '@deepseek-ai/dsh-util-values',
    ],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
