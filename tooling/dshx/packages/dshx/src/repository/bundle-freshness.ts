import { createHash } from 'node:crypto'
import * as Schema from 'effect/Schema'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Whether a plugin's bundles still match the sources their last build read. This source file can load under Node type
 * stripping so scripts/profile-sync.ts can use it on a checkout where dshx is not built.
 */

const dependencyManifestSchema = Schema.Struct({
  sources: Schema.Array(Schema.String),
  hashes: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
})
const packageScriptsSchema = Schema.Struct({ scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)) })

export type BundleFreshnessReport =
  | { readonly status: 'fresh' | 'not-buildable' | 'unbuilt' }
  | {
      readonly status: 'stale'
      /** The bundle file under dist/, e.g. `client.js`. */
      readonly bundle: string
      /** The plugin-relative source that changed or disappeared; null when the bundle itself is gone. */
      readonly source: string | null
      readonly reason: 'bundle-missing' | 'source-missing' | 'source-changed'
    }

/**
 * DSH loads a dist as it is, so after a base change or a failed build an old bundle boots against newer neighbours and
 * fails on imports. A source newer than its bundle counts only when its content differs from the hash the build
 * recorded, since a jj checkout rewrites files it leaves unchanged.
 */
// scripts/profile-sync.ts imports this file as TypeScript source under Node type stripping, where `../json.js` does not
// resolve; this module keeps its own schema-checked JSON boundary instead of importing src/json.ts.
const decodeJson = <S extends Schema.Constraint & { readonly DecodingServices: never }>(schema: S, text: string): S['Type'] =>
  Schema.decodeUnknownSync(Schema.fromJsonString(schema))(text)

const inspect = (input: { readonly directory: string }): BundleFreshnessReport => {
  const packagePath = join(input.directory, 'package.json')
  if (!existsSync(packagePath) || decodeJson(packageScriptsSchema, readFileSync(packagePath, 'utf8')).scripts?.build === undefined)
    return { status: 'not-buildable' }
  const distDirectory = join(input.directory, 'dist')
  if (!existsSync(join(distDirectory, 'index.js'))) return { status: 'unbuilt' }
  for (const manifestFile of readdirSync(distDirectory).filter(file => file.endsWith('.js.deps.json'))) {
    const bundle = manifestFile.slice(0, -'.deps.json'.length)
    const bundlePath = join(distDirectory, bundle)
    if (!existsSync(bundlePath)) return { status: 'stale', bundle, source: null, reason: 'bundle-missing' }
    const builtAt = statSync(bundlePath).mtimeMs
    const manifest = decodeJson(dependencyManifestSchema, readFileSync(join(distDirectory, manifestFile), 'utf8'))
    // A Windows build records `..\node_modules\…` sources, and Vite ids may carry a `?worker&inline` style query.
    for (const source of manifest.sources.filter(path => !/node_modules[\\/]/u.test(path))) {
      const sourcePath = resolve(input.directory, source.replace(/\?.*$/su, ''))
      if (!existsSync(sourcePath)) return { status: 'stale', bundle, source, reason: 'source-missing' }
      if (statSync(sourcePath).mtimeMs <= builtAt) continue
      const recorded = manifest.hashes?.[source]
      if (recorded === undefined || recorded !== createHash('sha256').update(readFileSync(sourcePath)).digest('hex'))
        return { status: 'stale', bundle, source, reason: 'source-changed' }
    }
  }
  return { status: 'fresh' }
}

export class BundleFreshness {
  static readonly inspect = inspect
}
