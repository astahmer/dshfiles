/**
 * Build the migration verifier as its own CJS worker bundle, the way the
 * upstream package's second tsdown entry does. The Host bundle is a single
 * `dist/index.js`; `migration-verifier.ts` loads `./worker.cjs` beside it, so
 * the worker must be emitted separately and must inline its closure: a fresh
 * verifier thread should not pay workspace module resolution.
 */

import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [join(root, 'src/native/worker.ts')],
  outfile: join(root, 'dist/worker.cjs'),
  absWorkingDir: root,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  // Bundled ESM dependencies read their own package metadata through
  // `createRequire(import.meta.url)`; a CJS bundle has no `import.meta`, so the
  // shim points it at this file and the resolution stays inside the plugin.
  banner: { js: "const importMetaUrl = require('node:url').pathToFileURL(__filename).href" },
  define: { 'import.meta.url': 'importMetaUrl' },
  // The native addon resolves a prebuilt binary beside itself; keep it a runtime
  // import so the worker uses the Host installation's copy.
  external: ['@deepseek-ai/node-addon-system', '@deepseek-ai/node-addon-system/*'],
})
