import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Schema } from 'effect'
import type { PluginContext } from './context.js'

// OpenCode MIT: packages/plugin/src/promise/plugin.ts, commit 67139d6827af.
const setupSchema = Schema.declare((value): value is (context: PluginContext) => unknown => typeof value === 'function')
const pluginSchema = Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)), setup: setupSchema })
const manifestSchema = Schema.Struct({ main: Schema.optionalKey(Schema.String), exports: Schema.optionalKey(Schema.Unknown) })

const exportPath = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined
  const record = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(value)
  if (record._tag === 'None') return undefined
  for (const key of ['.', 'import', 'node', 'default']) {
    const candidate = exportPath(record.value[key])
    if (candidate !== undefined) return candidate
  }
  return undefined
}

export const loadPlugin = async (input: { readonly specifier: string }) => {
  if (!isAbsolute(input.specifier)) throw new Error('Use an absolute path to a plugin file or directory.')
  let target = input.specifier
  if ((await stat(target)).isDirectory()) {
    let entry = 'index.js'
    try {
      const manifest = Schema.decodeUnknownSync(manifestSchema)(JSON.parse(await readFile(join(target, 'package.json'), 'utf8')))
      entry = exportPath(manifest.exports) ?? manifest.main ?? entry
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    target = resolve(target, entry)
  }
  const module: unknown = await import(pathToFileURL(target).href)
  const exports = Schema.decodeUnknownSync(
    Schema.Struct({ default: Schema.optionalKey(Schema.Unknown), server: Schema.optionalKey(Schema.Unknown), plugin: Schema.optionalKey(Schema.Unknown) }),
  )(module)
  return Schema.decodeUnknownSync(pluginSchema)(exports.default ?? exports.server ?? exports.plugin)
}
