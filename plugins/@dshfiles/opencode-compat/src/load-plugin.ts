import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodeJson } from '@dshfiles/dshx/json'
import { Schema } from 'effect'
import type { PluginContext } from './context.js'

// OpenCode MIT: packages/plugin/src/promise/plugin.ts, commit 67139d6827af.
export type Cleanup = () => void | Promise<void>
export type SetupResult = Cleanup | void
export type OpenCodeSetup = (context: PluginContext) => SetupResult | Promise<SetupResult>
const setupSchema = Schema.declare((value): value is OpenCodeSetup => typeof value === 'function')
const pluginSchema = Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)), setup: setupSchema })
const manifestSchema = Schema.Struct({ main: Schema.optionalKey(Schema.String), exports: Schema.optionalKey(Schema.Json) })

const exportPath = (value: typeof Schema.Json.Type | undefined): string | undefined => {
  const path = Schema.decodeUnknownOption(Schema.String)(value)
  if (path._tag === 'Some') return path.value
  const record = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json))(value)
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
      const manifest = decodeJson(manifestSchema, await readFile(join(target, 'package.json'), 'utf8'))
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
