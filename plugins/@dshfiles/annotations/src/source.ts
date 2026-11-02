import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cache, Context, Effect, FileSystem, Layer, Option, Schema } from 'effect'
import { MAX_BUNDLES, MAX_MAP_BYTES, MAX_TOTAL_MAP_BYTES } from './limits.js'
import { type RawSourceMap, SourceMaps } from './sourcemap.js'
import type { SourceMatch } from './schema.js'

export interface Bundle {
  readonly name: string
  readonly mapPath: string
  readonly codePath: string
}

const decodeSourceMap = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.optional(Schema.Number),
      mappings: Schema.String,
      sources: Schema.Array(Schema.String),
      sourcesContent: Schema.optional(Schema.Array(Schema.NullOr(Schema.String))),
      sourceRoot: Schema.optional(Schema.String),
    }),
  ),
)

const sourceMapOf = (raw: string): Option.Option<RawSourceMap> =>
  Option.map(decodeSourceMap(raw), (map): RawSourceMap => ({
    version: map.version ?? 3,
    sources: map.sources,
    mappings: map.mappings,
    ...(map.sourcesContent !== undefined && { sourcesContent: map.sourcesContent }),
    ...(map.sourceRoot !== undefined && { sourceRoot: map.sourceRoot }),
  }))

interface Fingerprint {
  readonly path: string
  /** Path, modification time and size: a changed file gets a new cache entry. */
  readonly key: string
  readonly size: number
}

const fingerprintOf = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, fileSystem => fileSystem.stat(path)).pipe(
    Effect.map(info => {
      const modified = Option.getOrElse(
        Option.map(info.mtime, date => date.getTime()),
        () => 0,
      )
      return Option.some<Fingerprint>({ path, key: `${path}\u0000${modified}\u0000${info.size}`, size: Number(info.size) })
    }),
    Effect.orElseSucceed(() => Option.none<Fingerprint>()),
  )

/**
 * The Host entry lives at `<repo>/plugins/@dshfiles/<pkg>/dist/index.js`, so its own
 * module URL names the sibling bundle root exactly — no guess about the process cwd.
 * A published package falls back to the env seam and then to the workspace walk.
 */
const rootFromModuleUrl = (moduleUrl: string | undefined): string[] => {
  if (moduleUrl === undefined || !moduleUrl.startsWith('file:')) return []
  const sibling = dirname(dirname(dirname(fileURLToPath(moduleUrl))))
  return /[\\/]plugins[\\/]@dshfiles$/.test(sibling) ? [sibling] : []
}

export const discoverPluginRoots = Effect.fn('annotations discover plugin roots')(function* (input: {
  readonly start: string
  readonly dshfilesDirectory: string | undefined
  readonly moduleUrl?: string | undefined
}) {
  const fromModule = rootFromModuleUrl(input.moduleUrl)
  if (fromModule.length > 0) return fromModule
  if (input.dshfilesDirectory !== undefined && input.dshfilesDirectory.length > 0) return [join(input.dshfilesDirectory, 'plugins', '@dshfiles')]
  const fileSystem = yield* FileSystem.FileSystem
  let current = input.start
  for (let depth = 0; depth < 8; depth += 1) {
    const workspace = yield* fileSystem.readFileString(join(current, 'pnpm-workspace.yaml')).pipe(Effect.option)
    if (Option.isSome(workspace)) return workspace.value.includes('plugins') ? [join(current, 'plugins', '@dshfiles')] : []
    const parent = dirname(current)
    if (parent === current) return []
    current = parent
  }
  return []
})

export const listBundles = Effect.fn('annotations list bundles')(function* (input: { readonly root: string; readonly limit?: number }) {
  const fileSystem = yield* FileSystem.FileSystem
  const entries = yield* fileSystem.readDirectory(input.root).pipe(Effect.orElseSucceed((): string[] => []))
  const candidates = [...entries]
    .sort()
    .slice(0, input.limit ?? MAX_BUNDLES)
    .map((entry): Bundle => {
      const codePath = join(input.root, entry, 'dist', 'client.js')
      return { name: entry, codePath, mapPath: `${codePath}.map` }
    })
  const built = yield* Effect.forEach(candidates, bundle => Effect.map(fingerprintOf(bundle.codePath), Option.isSome), { concurrency: 8 })
  return candidates.filter((_bundle, index) => built[index] === true)
})

/**
 * CSS-module class names from a stored selector, unescaped. A bare utility class
 * ("cta", "row") appears in too many bundles to be evidence; a module name carries
 * its hash and an underscore.
 */
export const classCandidates = (selector: string): string[] => {
  const matches = selector.match(/\.[^\s>]+/g) ?? []
  const names = matches.map(match => match.slice(1).replaceAll('\\', '')).filter(name => name.length >= 4 && name.includes('_'))
  return Array.from(new Set(names)).slice(0, 6)
}

/** A dependency's source is never the answer: the plugin that renders the element is. */
const ownedSource = (absolute: string): boolean => !absolute.split(/[\\/]/).includes('node_modules')

const absoluteOf = (input: { readonly bundle: Bundle; readonly source: string }): string =>
  input.source.startsWith('/') ? input.source : join(dirname(input.bundle.mapPath), input.source)

const pathOfKey = (key: string): string => key.slice(0, key.indexOf('\u0000'))

export interface SourceResolverShape {
  readonly resolve: (names: readonly string[]) => Effect.Effect<SourceMatch[]>
  readonly resolveText: (texts: readonly string[]) => Effect.Effect<SourceMatch[]>
  readonly bundles: Effect.Effect<Bundle[]>
  readonly roots: Effect.Effect<readonly string[]>
}

/** Maps a class name or a visible text back to the plugin source that rendered it, through the built bundles' source maps. */
export class SourceResolver extends Context.Service<SourceResolver, SourceResolverShape>()('@dshfiles/annotations/SourceResolver') {
  static readonly make = Effect.fnUntraced(function* (input: {
    readonly roots: readonly string[]
    readonly maxBundles?: number
    readonly maxMapBytes?: number
    readonly maxTotalMapBytes?: number
  }) {
    const fileSystem = yield* FileSystem.FileSystem
    const maxMapBytes = input.maxMapBytes ?? MAX_MAP_BYTES
    const maxTotalMapBytes = input.maxTotalMapBytes ?? MAX_TOTAL_MAP_BYTES
    const withFileSystem = Effect.provideService(FileSystem.FileSystem, fileSystem)
    const readText = (key: string) => fileSystem.readFileString(pathOfKey(key)).pipe(Effect.option)
    const texts = yield* Cache.make({ capacity: 256, lookup: readText })
    const maps = yield* Cache.make({ capacity: 256, lookup: (key: string) => Effect.map(readText(key), text => Option.flatMap(text, sourceMapOf)) })
    const bundles = yield* Effect.cached(
      Effect.map(
        Effect.forEach(input.roots, root => listBundles({ root, limit: input.maxBundles ?? MAX_BUNDLES })),
        found => found.flat(),
      ).pipe(withFileSystem),
    )

    const codeOf = (bundle: Bundle) =>
      Effect.flatMap(fingerprintOf(bundle.codePath), fingerprint => (Option.isNone(fingerprint) ? Effect.succeedNone : Cache.get(texts, fingerprint.value.key)))

    const mapOf = (bundle: Bundle) =>
      Effect.flatMap(fingerprintOf(bundle.mapPath), fingerprint =>
        Option.isNone(fingerprint) || fingerprint.value.size > maxMapBytes ? Effect.succeedNone : Cache.get(maps, fingerprint.value.key),
      )

    const positionFor = Effect.fnUntraced(function* (match: {
      readonly name: string
      readonly bundle: Bundle
      readonly map: RawSourceMap
      readonly confidence: 'map' | 'text'
    }) {
      if (match.confidence === 'text') return Option.fromUndefinedOr(SourceMaps.sourceContentPosition({ map: match.map, needle: match.name }))
      return Option.flatMap(yield* codeOf(match.bundle), code => {
        const generated = SourceMaps.findGeneratedPosition({ text: code, needle: match.name })
        return Option.fromUndefinedOr(generated === undefined ? undefined : SourceMaps.originalPositionFor({ map: match.map, position: generated }))
      })
    })

    const matchFor = Effect.fnUntraced(function* (match: {
      readonly name: string
      readonly bundle: Bundle
      readonly map: RawSourceMap
      readonly confidence: 'map' | 'text'
    }) {
      const position = yield* positionFor(match)
      if (Option.isNone(position)) return Option.none<SourceMatch>()
      const absolute = absoluteOf({ bundle: match.bundle, source: position.value.source })
      if (!ownedSource(absolute)) return Option.none<SourceMatch>()
      return Option.some<SourceMatch>({
        name: match.name,
        file: relative(process.cwd(), absolute),
        line: position.value.line,
        column: position.value.column,
        confidence: match.confidence,
      })
    })

    const scan = (needles: readonly string[], confidence: 'map' | 'text') =>
      Effect.gen(function* () {
        const available = yield* bundles
        const found: SourceMatch[] = []
        let scannedBytes = 0
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- every needle shares one total map-byte budget.
        for (const name of needles) {
          if (found.some(match => match.name === name)) continue
          // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- the scan stops at the first match and at the total map-byte budget.
          for (const bundle of available) {
            if (scannedBytes > maxTotalMapBytes) return found
            const map = yield* mapOf(bundle)
            if (Option.isNone(map)) continue
            scannedBytes += JSON.stringify(map.value).length
            const match = yield* matchFor({ name, bundle, map: map.value, confidence })
            if (Option.isSome(match)) {
              found.push(match.value)
              break
            }
          }
        }
        return found
      }).pipe(withFileSystem)

    return SourceResolver.of({
      resolve: names => scan(names, 'map').pipe(Effect.withSpan('annotations resolve source')),
      resolveText: needles => scan(needles, 'text').pipe(Effect.withSpan('annotations resolve text')),
      bundles,
      roots: Effect.succeed(input.roots),
    })
  })

  /** Resolves against the `@dshfiles` bundle root next to this Host, `DSHFILES_DIR`, or the enclosing workspace. */
  static readonly layer = (input: { readonly moduleUrl: string | undefined }) =>
    Layer.effect(
      SourceResolver,
      Effect.gen(function* () {
        const roots = yield* discoverPluginRoots({ start: process.cwd(), dshfilesDirectory: process.env.DSHFILES_DIR, moduleUrl: input.moduleUrl })
        return yield* SourceResolver.make({ roots })
      }),
    )
}
