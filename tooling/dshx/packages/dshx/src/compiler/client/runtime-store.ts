import { readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import type { Plugin } from 'vite'
import { RuntimeSnapshotKit } from '../host/runtime-store.js'

/** A store directory of its own: a Client snapshot holds browser modules that a Host bundle never imports. */
const STORE_DIRECTORY = 'client-runtime'
const SNAPSHOT_MANIFEST = '.dshx-snapshot.json'
/** Bare imports the snapshot copies next to its modules, as the Host snapshot does. */
const VENDORED = new Set(['create-dshx/runtime-capabilities'])

const SnapshotManifest = Schema.Struct({
  hash: Schema.String,
  exports: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  bare: Schema.Array(Schema.String),
})

/** One immutable Client runtime snapshot: each module keyed by the specifier a supplier serves it under. */
export interface ClientRuntimeSnapshot {
  readonly hash: string
  readonly directory: string
  /** Absolute runtime module path (in the running DSHX dist) -> its supplier key. */
  readonly keys: ReadonlyMap<string, string>
  /** Non-vendored bare imports of the snapshot, which the consumer must resolve to the same instance. */
  readonly bare: ReadonlySet<string>
}

/** A published snapshot as a supplier serves it: every module's key, file and export names. */
export interface StoredClientRuntime {
  readonly hash: string
  readonly modules: readonly { readonly key: string; readonly file: string; readonly names: readonly string[] }[]
}

export type ClientRuntimeOutcome = { readonly mode: 'shared'; readonly hash: string } | { readonly mode: 'inline'; readonly reason: string }

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

const keyOf = (hash: string, path: string): string => `${RuntimeSnapshotKit.packageName}/${STORE_DIRECTORY}/${hash}/${path}`

/** Snapshot every Client runtime module reachable from `entries`, or explain why consumers must keep inlining it. */
const prepare = async (options: {
  readonly runtimeRoot: string
  readonly entries: readonly string[]
}): Promise<ClientRuntimeSnapshot | { readonly reason: string }> => {
  try {
    const captured = await RuntimeSnapshotKit.capture(options)
    const exports: Record<string, readonly string[]> = {}
    for (const file of captured.graph.modules.keys()) {
      const names = RuntimeSnapshotKit.exportedNames(captured.graph, file)
      if (names === undefined) RuntimeSnapshotKit.unavailable(`runtime module ${file} re-exports a bare module, so a facade cannot name its exports`)
      exports[RuntimeSnapshotKit.modulePath(captured.runtimeRoot, file)] = [...(names ?? [])].sort()
    }
    if (captured.graph.dynamicBare.size > 0) RuntimeSnapshotKit.unavailable(`the Client runtime lazily imports ${[...captured.graph.dynamicBare].join(', ')}`)
    const bare = [...captured.graph.staticBare].filter(specifier => !VENDORED.has(specifier)).sort()
    const directory = await RuntimeSnapshotKit.publish(join(captured.packageRoot, STORE_DIRECTORY), captured.hash, captured.files, { exports, bare })
    const keys = new Map(
      [...captured.graph.modules.keys()].map(file => [file, keyOf(captured.hash, RuntimeSnapshotKit.modulePath(captured.runtimeRoot, file))]),
    )
    return { hash: captured.hash, directory, keys, bare: new Set(bare) }
  } catch (cause) {
    if (RuntimeSnapshotKit.isUnavailable(cause)) return { reason: cause.message }
    throw cause
  }
}

/** Every snapshot published in the store of the DSHX package at `packageRoot`, oldest hash first by name. */
const stored = async (packageRoot: string): Promise<readonly StoredClientRuntime[]> => {
  const storeRoot = join(packageRoot, STORE_DIRECTORY)
  const snapshots: StoredClientRuntime[] = []
  for (const entry of (await readdir(storeRoot, { withFileTypes: true }).catch(() => [])).sort((left, right) => (left.name < right.name ? -1 : 1))) {
    if (!entry.isDirectory() || !/^[0-9a-f]{20}$/u.test(entry.name)) continue
    const directory = join(storeRoot, entry.name)
    const text = await readFile(join(directory, SNAPSHOT_MANIFEST), 'utf8').catch(() => undefined)
    let parsed: unknown
    try {
      parsed = text === undefined ? undefined : JSON.parse(text)
    } catch {
      continue
    }
    const manifest = Option.getOrUndefined(Schema.decodeUnknownOption(SnapshotManifest)(parsed))
    if (manifest?.hash !== entry.name) continue
    snapshots.push({
      hash: manifest.hash,
      modules: Object.entries(manifest.exports).map(([path, names]) => ({ key: keyOf(manifest.hash, path), file: join(directory, path), names })),
    })
  }
  return snapshots
}

/**
 * The snapshots a supplier serves: the one its own build publishes, plus every one a built consumer bundle names.
 * Consumers are the supplier's sibling packages (`<scope>/*\/dist`), the same bundles `prune` keeps snapshots for, so a
 * stored hash nothing references is neither served nor kept past the grace period.
 */
const served = async (options: {
  readonly packageRoot: string
  readonly supplierRoot: string
  readonly current: string | undefined
}): Promise<readonly StoredClientRuntime[]> => {
  const referenced = await RuntimeSnapshotKit.referencedHashes(await consumerDistRoots(options.supplierRoot), STORE_DIRECTORY)
  return (await stored(options.packageRoot)).filter(snapshot => snapshot.hash === options.current || referenced.has(snapshot.hash))
}

/** Built output directories of the supplier's sibling packages. */
const consumerDistRoots = async (supplierRoot: string): Promise<readonly string[]> => {
  const scope = dirname(supplierRoot)
  const entries = await readdir(scope, { withFileTypes: true }).catch(() => [])
  return entries.filter(entry => entry.isDirectory() && join(scope, entry.name) !== supplierRoot).map(entry => join(scope, entry.name, 'dist'))
}

/**
 * Consumer side: point every import of a snapshotted runtime module at the facade the shared-runtime consumer plugin
 * loads, so the plugin re-reads the supplier's single instance instead of bundling its own. Relative imports between
 * runtime modules never reach here once their importer is a facade; the check also covers DSHX modules outside the
 * snapshot that import into it.
 */
const consumerPlugin = (options: {
  readonly snapshot: ClientRuntimeSnapshot
  readonly runtimeRoot: string
  readonly facade: (key: string) => string
}): Plugin => {
  let runtimeRoot: string | undefined
  return {
    name: 'dshx-client-runtime-consumer',
    enforce: 'pre',
    async buildStart() {
      runtimeRoot = await realpath(options.runtimeRoot)
    },
    async resolveId(source, importer) {
      if (importer === undefined || runtimeRoot === undefined) return null
      const fromRuntime = isAbsolute(importer) && isInside(runtimeRoot, importer)
      if (!(isAbsolute(source) || source.startsWith(`${RuntimeSnapshotKit.packageName}/`) || (fromRuntime && source.startsWith('.')))) return null
      const resolved =
        isAbsolute(source) || source.startsWith('.')
          ? resolve(isAbsolute(source) ? '/' : join(importer, '..'), source)
          : (await this.resolve(source, importer, { skipSelf: true }))?.id
      if (resolved === undefined) return null
      const key = options.snapshot.keys.get(await realpath(resolved).catch(() => resolved))
      return key === undefined ? null : options.facade(key)
    },
  }
}

/** Supplier side: resolve a stored snapshot's bare imports from the supplier, so they share its provided instances. */
const supplierPlugin = (options: { readonly root: string; readonly packageRoot: string }): Plugin => {
  const storeRoot = join(options.packageRoot, STORE_DIRECTORY)
  return {
    name: 'dshx-client-runtime-supplier',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (importer === undefined || !isInside(storeRoot, importer) || source.startsWith('.') || isAbsolute(source) || source.startsWith('\0')) return null
      return this.resolve(source, join(options.root, 'package.json'), { skipSelf: true })
    },
  }
}

/** Remove Client snapshots no built bundle names and that are past the grace period, as the Host store does. */
const prune = (options: { readonly packageRoot: string; readonly referenceRoots: readonly string[]; readonly graceMs?: number; readonly now?: number }) =>
  RuntimeSnapshotKit.prune({ ...options, storeRoot: join(options.packageRoot, STORE_DIRECTORY) })

/**
 * The DSHX Client runtime as an immutable, content-addressed snapshot a shared-runtime supplier serves under
 * `@dshfiles/dshx/client-runtime/<hash>/<module>`. A consumer uses it only when its supplier was built with that hash.
 */
export class ClientRuntimeStore {
  static readonly isKey = (specifier: string): boolean => specifier.startsWith(`${RuntimeSnapshotKit.packageName}/${STORE_DIRECTORY}/`)
  static readonly prepare = prepare
  static readonly stored = stored
  static readonly served = served
  static readonly consumerDistRoots = consumerDistRoots
  static readonly prune = prune
  static readonly consumerPlugin = consumerPlugin
  static readonly supplierPlugin = supplierPlugin
}
