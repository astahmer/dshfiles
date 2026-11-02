import { createHash } from 'node:crypto'
import { Clock, Context, Duration, Effect, FileSystem, Layer, Option, Path, Ref, Schema, Semaphore } from 'effect'

/** The slice of the Host's client module registry used to locate each loaded plugin package. */
export interface PluginRegistry {
  readonly ids: () => readonly string[]
  readonly clientPath: (id: string) => string | undefined
}

const entryTargetSchema = Schema.Union([Schema.String, Schema.Struct({ import: Schema.optional(Schema.String), default: Schema.optional(Schema.String) })])
const manifestSchema = Schema.Struct({
  name: Schema.String,
  main: Schema.optional(Schema.String),
  exports: Schema.optional(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)])),
})
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(manifestSchema))
const decodeEntryTarget = Schema.decodeUnknownOption(entryTargetSchema)

/** A file's identity hint: any change here invalidates the cached hash without reading the bytes. */
interface FileRevision {
  readonly size: number
  readonly mtimeMs: number
  readonly inode: string
}

/** Where the Host resolved one package at boot: its root and its Host entry. */
interface ResolvedPackage {
  readonly directory: string
  readonly hostEntry: string
}

interface HashedPackage {
  readonly hash: string
  readonly revisions: readonly (FileRevision | undefined)[]
  readonly hashedAt: number
}

/** Same revision means the bytes are the ones already hashed; a missing hint on either side forces a re-read. */
const sameRevision = (left: FileRevision | undefined, right: FileRevision | undefined): boolean =>
  // A file that is still absent on both sides is unchanged; one side appearing or vanishing is not.
  left === undefined || right === undefined ? left === right : left.size === right.size && left.mtimeMs === right.mtimeMs && left.inode === right.inode

/** How many plugins one scan probes at once; a workspace with many plugins must not open a read per plugin. */
const SCAN_CONCURRENCY = 4
/** A revision hint is not proof forever: past this age the bytes are read and hashed again. */
const REHASH_AFTER = Duration.seconds(30)

/**
 * Remembers each plugin package as first seen (at boot, or when it joins the graph) and reports the ones whose Host
 * code or manifest changed on disk since, which only a restart loads. Content hashes, not mtimes, so rebuilding every
 * UI plugin with identical output flags nothing. The resolved package topology and each file's revision are cached,
 * so a check that finds every file at the revision its hash came from reads nothing at all; a metadata change is only
 * an invalidation hint, so the bytes are read and hashed again before anything is reported.
 */
export class PluginUpdateWatch extends Context.Service<
  PluginUpdateWatch,
  {
    /** Hash every package of the registry not seen yet, as its baseline. */
    readonly remember: (registry: PluginRegistry) => Effect.Effect<void>
    readonly pending: (registry: PluginRegistry) => Effect.Effect<ReadonlyArray<string>>
  }
>()('@dshfiles/thread-sidebar/PluginUpdateWatch') {
  static readonly layerWith = (options: { readonly rehashAfter?: Duration.Duration } = {}) =>
    Layer.effect(
      PluginUpdateWatch,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const rehashAfterMs = Duration.toMillis(options.rehashAfter ?? REHASH_AFTER)
        const baselines = yield* Ref.make<ReadonlyMap<string, string | null>>(new Map())
        const topology = yield* Ref.make<ReadonlyMap<string, ResolvedPackage>>(new Map())
        const hashes = yield* Ref.make<ReadonlyMap<string, HashedPackage>>(new Map())
        const scanning = (yield* Semaphore.make(1)).withPermits(1)

        const readOptional = (file: string) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => ''))

        const revisionOf = (file: string) =>
          fs.stat(file).pipe(
            Effect.map((info): FileRevision | undefined => ({
              size: Number(info.size),
              mtimeMs: Option.match(info.mtime, { onNone: () => -1, onSome: date => date.getTime() }),
              inode: Option.match(info.ino, { onNone: () => '', onSome: String }),
            })),
            Effect.orElseSucceed(() => undefined),
          )

        const filesOf = (resolved: ResolvedPackage) => [
          path.join(resolved.directory, 'package.json'),
          path.join(resolved.directory, resolved.hostEntry),
          path.join(resolved.directory, 'cordis.patch.yml'),
        ]

        /** The package that owns a client bundle: the nearest manifest up the tree whose name is the registry id. */
        const resolvePackage = Effect.fnUntraced(function* (id: string, clientPath: string) {
          let directory = path.dirname(clientPath)
          for (;;) {
            const manifest = decodeManifest(yield* readOptional(path.join(directory, 'package.json')))
            if (Option.isSome(manifest) && manifest.value.name === id) {
              const exports = manifest.value.exports
              if (typeof exports === 'string') return Option.some({ directory, hostEntry: exports })
              const exported = Option.getOrUndefined(decodeEntryTarget(exports?.['.']))
              const hostEntry = typeof exported === 'string' ? exported : (exported?.import ?? exported?.default ?? manifest.value.main ?? 'index.js')
              return Option.some({ directory, hostEntry })
            }
            const parent = path.dirname(directory)
            if (parent === directory) return Option.none<ResolvedPackage>()
            directory = parent
          }
        })

        /** The Host facts one package serves: its manifest, its Host entry and its bundle patch; not the hot-reloaded client. */
        const current = Effect.fnUntraced(function* (registry: PluginRegistry, id: string) {
          const clientPath = registry.clientPath(id)
          if (clientPath === undefined) return null
          const now = yield* Clock.currentTimeMillis
          const known = (yield* Ref.get(topology)).get(id)
          const cached = (yield* Ref.get(hashes)).get(id)
          if (known !== undefined && cached !== undefined && now - cached.hashedAt < rehashAfterMs) {
            const revisions = yield* Effect.forEach(filesOf(known), revisionOf)
            if (revisions.every((revision, index) => sameRevision(revision, cached.revisions[index]))) return cached.hash
          }
          const resolved = known === undefined ? yield* resolvePackage(id, clientPath) : Option.some(known)
          if (Option.isNone(resolved)) return null
          const files = filesOf(resolved.value)
          const revisions = yield* Effect.forEach(files, revisionOf)
          const contents = yield* Effect.forEach(files, readOptional)
          const hash = contents.reduce((digest, text) => digest.update(text).update('\0'), createHash('sha256')).digest('hex')
          yield* Ref.update(topology, map => new Map(map).set(id, resolved.value))
          yield* Ref.update(hashes, map => new Map(map).set(id, { hash, revisions, hashedAt: now }))
          return hash
        })

        const remember = Effect.fn('plugin updates remember')(function* (registry: PluginRegistry) {
          const known = yield* Ref.get(baselines)
          const fresh = registry.ids().filter(id => !known.has(id))
          const hashed = yield* Effect.forEach(fresh, id => Effect.map(current(registry, id), hash => [id, hash] as const), { concurrency: SCAN_CONCURRENCY })
          yield* Ref.update(baselines, map => new Map([...map, ...hashed]))
        })

        return PluginUpdateWatch.of({
          remember: registry => scanning(remember(registry)),
          // One scan at a time: a poll that lands while another runs waits and then finds every file at its cached revision.
          pending: Effect.fn('plugin updates pending')(function* (registry) {
            return yield* scanning(
              Effect.gen(function* () {
                yield* remember(registry)
                const ids = registry.ids()
                const before = yield* Ref.get(baselines)
                const changed = yield* Effect.forEach(
                  ids,
                  id =>
                    Effect.map(current(registry, id), now => {
                      const baseline = before.get(id)
                      return baseline !== null && baseline !== undefined && now !== null && baseline !== now ? [id] : []
                    }),
                  { concurrency: SCAN_CONCURRENCY },
                )
                // A plugin that left the graph must not keep its topology or hash alive.
                const registered = new Set(ids)
                const keep = <V>(map: ReadonlyMap<string, V>) => new Map([...map].filter(([id]) => registered.has(id)))
                yield* Ref.update(hashes, keep)
                yield* Ref.update(topology, keep)
                return changed.flat().sort()
              }),
            )
          }),
        })
      }),
    )

  static readonly layer = PluginUpdateWatch.layerWith()
}

/** One client bundle revision: the entry id and the artifact revision a page runs for it. */
export interface ClientEntryRevision {
  readonly id: string
  readonly rev: string
}

/**
 * Which client bundles a page must reload for: the ones it runs at another revision than the Host serves, plus
 * entries the Host serves that the page never loaded. A page that picked a rebuild up over hot reload reports the
 * current revision and drops off this list, so the answer names only what a reload would actually change.
 */
export const staleClientEntries = ({
  page,
  served,
}: {
  readonly page: readonly ClientEntryRevision[]
  readonly served: readonly ClientEntryRevision[]
}): { readonly stale: string[]; readonly added: string[] } => {
  const loaded = new Map(page.map(entry => [entry.id, entry.rev]))
  const current = new Map(served.map(entry => [entry.id, entry.rev]))
  return {
    stale: page
      .filter(entry => current.get(entry.id) !== undefined && current.get(entry.id) !== entry.rev)
      .map(entry => entry.id)
      .sort(),
    added: served
      .filter(entry => !loaded.has(entry.id))
      .map(entry => entry.id)
      .sort(),
  }
}
