// The Host's typert-loader reads a Loader entry's generated Remote descriptors from its package's `./typert` export
// and requires the manifest to name that package. This fork keeps the native Remote surface byte-identical, so its
// descriptors are the native package's generated ones, with the owning package renamed. Regenerated on every build.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NATIVE = '@deepseek-ai/dsh-api-session-controller'
const OWNED = '@dshfiles/session-controller'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const native = dirname(createRequire(join(root, 'package.json')).resolve(`${NATIVE}/package.json`))

mkdirSync(join(root, 'typert'), { recursive: true })
for (const [from, to] of [
  ['lib/typert.host.js', 'typert/host.js'],
  ['lib/typert.host.d.ts', 'typert/host.d.ts'],
]) {
  const source = readFileSync(join(native, from), 'utf8')
  const manifest = `  package: '${NATIVE}',`
  const count = source.split(manifest).length - 1
  if (from.endsWith('.js') && count !== 2) throw new Error(`derive-typert: expected 2 manifest package lines in ${from}, found ${count}`)
  writeFileSync(
    join(root, to),
    `/* Derived by scripts/derive-typert.mjs from ${NATIVE}/${from} — do not edit. */\n${source.replaceAll(manifest, `  package: '${OWNED}',`)}`,
  )
}
