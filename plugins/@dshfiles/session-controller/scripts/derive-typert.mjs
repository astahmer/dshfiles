// The Host's typert-loader reads a Loader entry's generated Remote descriptors from its package's `./typert` export
// and requires the manifest to name that package. This fork keeps the native Remote surface, so its descriptors are the
// native package's generated ones with the owning package renamed and the fork's optional list-selector field added.
// Regenerated on every build.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NATIVE = '@deepseek-ai/dsh-api-session-controller'
const OWNED = '@dshfiles/session-controller'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const native = dirname(createRequire(join(root, 'package.json')).resolve(`${NATIVE}/package.json`))

/**
 * The fork adds one optional list-request field the native descriptor cannot know about. Patch both codecs (the
 * permissive `create` one and the strict wire one) plus their published JSON Schemas, and refuse to write a descriptor
 * whose shape the native bump changed under us.
 */
const addListProjections = (source, file) => {
  const pair = (factory, suffix) =>
    `const _deepseek_ai_dsh_api_session_controller_session_list_parameter_0${suffix}$schema = () => (_deepseek_ai_dsh_api_session_controller_session_list_parameter_0${suffix}$schema$value ??= ${factory}({\n  'cursor': z.string().readonly().optional(),\n}))`
  let patched = source
  for (const [factory, suffix] of [
    ['z.object', ''],
    ['z.strictObject', '_strict'],
  ]) {
    const before = pair(factory, suffix)
    if (patched.split(before).length !== 2) throw new Error(`derive-typert: ${file} is missing the ${factory} list request schema`)
    patched = patched.replace(
      before,
      before.replace(
        "'cursor': z.string().readonly().optional(),",
        "'cursor': z.string().readonly().optional(),\n  'projections': z.array(z.string()).readonly().optional(),",
      ),
    )
  }
  const jsonProperties = '"properties":{"cursor":{"type":"string"}}'
  if (patched.split(jsonProperties).length !== 3) throw new Error(`derive-typert: ${file} is missing the list request JSON schemas`)
  patched = patched.replaceAll(jsonProperties, '"properties":{"cursor":{"type":"string"},"projections":{"type":"array","items":{"type":"string"}}}')
  return patched
}

mkdirSync(join(root, 'typert'), { recursive: true })
for (const [from, to] of [
  ['lib/typert.host.js', 'typert/host.js'],
  ['lib/typert.host.d.ts', 'typert/host.d.ts'],
]) {
  const source = readFileSync(join(native, from), 'utf8')
  const manifest = `  package: '${NATIVE}',`
  const count = source.split(manifest).length - 1
  if (from.endsWith('.js') && count !== 2) throw new Error(`derive-typert: expected 2 manifest package lines in ${from}, found ${count}`)
  const renamed = source.replaceAll(manifest, `  package: '${OWNED}',`)
  writeFileSync(
    join(root, to),
    `/* Derived by scripts/derive-typert.mjs from ${NATIVE}/${from} — do not edit. */\n${from.endsWith('.js') ? addListProjections(renamed, from) : renamed}`,
  )
}
