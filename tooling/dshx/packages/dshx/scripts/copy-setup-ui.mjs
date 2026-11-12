/**
 * Copy the built `dshx setup` page into `dist/setup-ui`, where the setup command serves it from.
 *
 * The page is its own package (`@dshfiles/setup-ui`) that dshx does not depend on: it imports the plugin-ui kit, which
 * depends on dshx. turbo.json orders `@dshfiles/setup-ui#build` before this build instead of a package edge.
 */
import { cp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const built = join(packageRoot, '../setup-ui/dist')
const target = join(packageRoot, 'dist/setup-ui')

await rm(target, { recursive: true, force: true })
if (existsSync(join(built, 'index.html'))) await cp(built, target, { recursive: true })
else process.stderr.write('copy-setup-ui: tooling/dshx/packages/setup-ui/dist is not built; dshx setup will say so until it is.\n')
