import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NodeFileSystem } from '@effect/platform-node'
import { Effect, FileSystem, Schema } from 'effect'
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

const exportsSchema = Schema.Struct({
  default: Schema.optionalKey(Schema.Unknown),
  server: Schema.optionalKey(Schema.Unknown),
  plugin: Schema.optionalKey(Schema.Unknown),
})

/** The Promise edge the runtime loads through: resolve the entry file, import it, and decode its plugin export. */
export const loadPlugin = (input: { readonly specifier: string }) => {
  const specifier = input.specifier
  if (!isAbsolute(specifier)) return Promise.reject(new Error('Use an absolute path to a plugin file or directory.'))
  return Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      let target = specifier
      if ((yield* fs.stat(specifier)).type === 'Directory') {
        const manifestText = yield* fs.readFileString(join(specifier, 'package.json')).pipe(
          Effect.catchIf(
            error => error.reason._tag === 'NotFound',
            () => Effect.succeed(undefined),
          ),
        )
        const manifest = manifestText === undefined ? undefined : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(manifestSchema))(manifestText)
        target = resolve(specifier, exportPath(manifest?.exports) ?? manifest?.main ?? 'index.js')
      }
      const module = yield* Effect.promise(() => import(pathToFileURL(target).href))
      const exports = yield* Schema.decodeUnknownEffect(exportsSchema)(module)
      return yield* Schema.decodeUnknownEffect(pluginSchema)(exports.default ?? exports.server ?? exports.plugin)
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
}
