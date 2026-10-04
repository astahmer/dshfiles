/**
 * Copy the ambient declaration scripts into `dist`.
 *
 * `tsc` compiles modules but does not copy a standalone `.d.ts`, so without this
 * step the CSS-module declaration would exist in the repository and be missing
 * from the published package.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const ambient = ['client/css-modules.d.ts']

for (const relative of ambient) {
  const target = join(packageRoot, 'dist', relative)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(join(packageRoot, 'src', relative), target)
}

/**
 * `tsc` drops the triple-slash reference from an emitted `.d.ts`, so the ambient
 * file it points at would be shipped but never loaded. Re-add it.
 */
const reference = '/// <reference path="./css-modules.d.ts" />\n\n'
for (const name of ['index', 'env']) {
  const clientEntry = join(packageRoot, `dist/client/${name}.d.ts`)
  const entry = await readFile(clientEntry, 'utf8')
  if (!entry.startsWith('///')) await writeFile(clientEntry, reference + entry)
}
