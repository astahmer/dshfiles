import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { createRequire, findPackageJSON, isBuiltin } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { parseSync } from 'oxc-parser'
import type { Plugin } from 'vite'
import { DshxError } from '../../diagnostics.js'

const PACKAGE_NAME = '@dshfiles/dshx'
const STORE_DIRECTORY = 'runtime-store'
const SNAPSHOT_MANIFEST = '.dshx-snapshot.json'
const FORMAT_VERSION = 1
/** Bare imports the Host build bundles instead of externalizing; a snapshot vendors them for the same reason. */
const VENDORED_SPECIFIERS = new Set(['create-dshx/capabilities', 'create-dshx/runtime-capabilities'])
const VENDOR_DIRECTORY = '_vendor'
/** A snapshot younger than this is never pruned: a build may have published it and not yet written its bundle. */
const DEFAULT_PRUNE_GRACE_MS = 86_400_000 // 1 day

interface SnapshotFile {
  readonly path: string
  readonly content: string
}

/** One immutable, content-addressed copy of the DSHX Host runtime modules. */
export interface RuntimeSnapshot {
  readonly hash: string
  readonly directory: string
  /** Absolute runtime module path -> the bare specifier a Host bundle imports it through. */
  readonly specifiers: ReadonlyMap<string, string>
}

export type RuntimeSnapshotOutcome = { readonly mode: 'snapshot'; readonly hash: string } | { readonly mode: 'inline'; readonly reason: string }

interface ModuleGraph {
  readonly modules: ReadonlyMap<string, string>
  readonly staticBare: ReadonlySet<string>
  readonly dynamicBare: ReadonlySet<string>
  readonly vendored: ReadonlySet<string>
}

/** Names a runtime module exports itself, and the modules it re-exports with `export *`. */
interface ModuleExports {
  readonly names: Set<string>
  readonly stars: string[]
}

class SnapshotUnavailable extends Error {}

const unavailable = (reason: string): never => {
  throw new SnapshotUnavailable(reason)
}

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

const StoreManifest = Schema.Struct({ hash: Schema.String })
const DshxManifest = Schema.Struct({ name: Schema.Literal(PACKAGE_NAME), exports: Schema.Struct({ [`./${STORE_DIRECTORY}/*`]: Schema.String }) })

const readJson = async <S extends Schema.Decoder<unknown>>(schema: S, file: string): Promise<S['Type'] | undefined> => {
  const text = await readFile(file, 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  try {
    return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(JSON.parse(text)))
  } catch {
    return undefined
  }
}

/** The package directory `specifier` resolves to from `fromDirectory`, by realpath, or undefined when it does not resolve. */
const resolvedPackage = async (specifier: string, fromDirectory: string): Promise<string | undefined> => {
  try {
    const manifest = findPackageJSON(specifier, pathToFileURL(join(fromDirectory, 'index.js')))
    return manifest === undefined ? undefined : dirname(await realpath(manifest))
  } catch {
    return undefined
  }
}

/** Walk the relative static import graph of the runtime entries, collecting their bare imports and checking named links. */
const moduleGraph = async (runtimeRoot: string, entries: readonly string[]): Promise<ModuleGraph> => {
  const modules = new Map<string, string>()
  const staticBare = new Set<string>()
  const dynamicBare = new Set<string>()
  const vendored = new Set<string>()
  const exportsOf = new Map<string, ModuleExports>()
  const namedImports: { readonly from: string; readonly target: string; readonly name: string }[] = []
  const pending = [...entries]
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (modules.has(file)) continue
    if (!isInside(runtimeRoot, file) || !file.endsWith('.js')) unavailable(`runtime module ${file} is not a built .js file inside ${runtimeRoot}`)
    const source = await readFile(file, 'utf8').catch(() => unavailable(`runtime module ${file} is missing`))
    const parsed = parseSync(file, source, { sourceType: 'module' })
    if (parsed.errors.length > 0) unavailable(`runtime module ${file} does not parse: ${parsed.errors[0]?.message ?? 'unknown error'}`)
    if (parsed.module.importMetas.length > 0) unavailable(`runtime module ${file} reads import.meta, which would change meaning in a snapshot`)
    modules.set(file, source)
    const exports: ModuleExports = { names: new Set(), stars: [] }
    exportsOf.set(file, exports)
    const follow = (specifier: string, dynamic: boolean): string | undefined => {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier)
        pending.push(target)
        return target
      }
      if (isAbsolute(specifier)) unavailable(`runtime module ${file} imports the absolute path ${specifier}`)
      if (VENDORED_SPECIFIERS.has(specifier)) {
        if (dynamic) unavailable(`runtime module ${file} lazily imports the vendored module ${specifier}`)
        vendored.add(specifier)
      } else if (!isBuiltin(specifier)) (dynamic ? dynamicBare : staticBare).add(specifier)
      return undefined
    }
    for (const declaration of parsed.module.staticImports) {
      const target = follow(declaration.moduleRequest.value, false)
      if (target === undefined) continue
      for (const entry of declaration.entries) {
        if (entry.isType) continue
        if (entry.importName.kind === 'Name' && entry.importName.name !== null) namedImports.push({ from: file, target, name: entry.importName.name })
        if (entry.importName.kind === 'Default') namedImports.push({ from: file, target, name: 'default' })
      }
    }
    for (const declaration of parsed.module.staticExports) {
      for (const entry of declaration.entries) {
        const target = entry.moduleRequest === null ? undefined : follow(entry.moduleRequest.value, false)
        if (entry.exportName.kind === 'Name' && entry.exportName.name !== null) exports.names.add(entry.exportName.name)
        if (entry.exportName.kind === 'Default') exports.names.add('default')
        if (target !== undefined && entry.exportName.kind === 'None' && entry.importName.kind === 'AllButDefault') exports.stars.push(target)
        if (target !== undefined && entry.importName.kind === 'Name' && entry.importName.name !== null)
          namedImports.push({ from: file, target, name: entry.importName.name })
      }
    }
    for (const declaration of parsed.module.dynamicImports) {
      const literal = /^(['"])(.*)\1$/su.exec(source.slice(declaration.moduleRequest.start, declaration.moduleRequest.end))
      if (literal?.[2] !== undefined) follow(literal[2], true)
    }
  }
  // A dist captured while tsc rewrites it can mix generations; refuse a snapshot whose modules do not link.
  const provides = (file: string, name: string, seen: Set<string> = new Set()): boolean => {
    if (seen.has(file)) return false
    seen.add(file)
    const exports = exportsOf.get(file)
    if (exports === undefined) return false
    return exports.names.has(name) || (name !== 'default' && exports.stars.some(star => provides(star, name, seen)))
  }
  for (const link of namedImports) {
    if (!provides(link.target, link.name))
      unavailable(`${relative(runtimeRoot, link.from)} imports ${link.name} that ${relative(runtimeRoot, link.target)} does not export (dist mid-rebuild?)`)
  }
  return { modules, staticBare, dynamicBare, vendored }
}

/** Rewrite each vendored bare import to the relative path of its copy inside the snapshot. */
const rewriteVendored = (file: string, source: string, toVendor: (specifier: string) => string): string => {
  const parsed = parseSync(file, source, { sourceType: 'module' })
  const requests = [
    ...parsed.module.staticImports.map(declaration => declaration.moduleRequest),
    ...parsed.module.staticExports.flatMap(declaration => declaration.entries.flatMap(entry => (entry.moduleRequest === null ? [] : [entry.moduleRequest]))),
  ]
    .filter(request => VENDORED_SPECIFIERS.has(request.value))
    .sort((left, right) => right.start - left.start)
  let output = source
  for (const request of requests) {
    const quoted = output.slice(request.start, request.end)
    if (quoted.slice(1, -1) !== request.value) throw new DshxError('DSHX1307', `Cannot rewrite the vendored import ${request.value} in ${file}.`)
    output = `${output.slice(0, request.start)}${JSON.stringify(toVendor(request.value))}${output.slice(request.end)}`
  }
  return output
}

const snapshotFiles = async (packageRoot: string, runtimeRoot: string, graph: ModuleGraph): Promise<readonly SnapshotFile[]> => {
  const files: SnapshotFile[] = []
  for (const [file, source] of graph.modules) {
    const path = relative(runtimeRoot, file).split(sep).join('/')
    const depth = path.split('/').length - 1
    const toVendor = (specifier: string): string => `${depth === 0 ? './' : '../'.repeat(depth)}${VENDOR_DIRECTORY}/${specifier}.js`
    files.push({ path, content: rewriteVendored(file, source, toVendor) })
  }
  const require = createRequire(join(packageRoot, 'index.js'))
  for (const specifier of graph.vendored) {
    const vendoredFile = (() => {
      try {
        return require.resolve(specifier)
      } catch {
        return unavailable(`vendored module ${specifier} does not resolve from ${packageRoot}`)
      }
    })()
    const content = await readFile(vendoredFile, 'utf8')
    const parsed = parseSync(vendoredFile, content, { sourceType: 'module' })
    if (
      parsed.module.staticImports.length > 0 ||
      parsed.module.dynamicImports.length > 0 ||
      parsed.module.staticExports.some(declaration => declaration.entries.some(entry => entry.moduleRequest !== null))
    ) {
      unavailable(`vendored module ${specifier} imports other modules`)
    }
    files.push({ path: `${VENDOR_DIRECTORY}/${specifier}.js`, content })
  }
  return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

/** The content address of a snapshot: every file path and byte, in a stable order. */
const contentHash = (files: readonly SnapshotFile[]): string => {
  const hash = createHash('sha256').update(`dshx-runtime-snapshot:${FORMAT_VERSION}\0`)
  for (const file of files) hash.update(`${file.path}\0${file.content}\0`)
  return hash.digest('hex').slice(0, 20)
}

/**
 * Write the snapshot once. An existing directory for the hash already holds these bytes, so it is never rewritten;
 * a new one is staged beside the store and renamed into place, so no reader ever sees a partial snapshot.
 */
const publish = async (storeRoot: string, hash: string, files: readonly SnapshotFile[]): Promise<string> => {
  const directory = join(storeRoot, hash)
  if ((await readJson(StoreManifest, join(directory, SNAPSHOT_MANIFEST)))?.hash === hash) {
    const now = new Date()
    await utimes(directory, now, now)
    return directory
  }
  const staging = join(storeRoot, `.staging-${hash}-${process.pid}-${randomBytes(4).toString('hex')}`)
  try {
    for (const file of files) {
      const target = join(staging, file.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.content, { encoding: 'utf8', flag: 'wx' })
      await chmod(target, 0o444)
    }
    await writeFile(join(staging, SNAPSHOT_MANIFEST), `${JSON.stringify({ version: FORMAT_VERSION, hash, files: files.map(file => file.path) }, null, 2)}\n`, {
      flag: 'wx',
    })
    await rename(staging, directory).catch(async (cause: unknown) => {
      // Another build published the same content first.
      if ((await readJson(StoreManifest, join(directory, SNAPSHOT_MANIFEST)))?.hash !== hash) throw cause
    })
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return directory
}

/**
 * Check that moving the runtime from the plugin bundle into the store cannot change which package any import loads.
 * A package the plugin resolves must be the very same directory from the store. A lazy import must behave the same
 * either way, including failing. Only a static import the plugin cannot resolve may load the copy DSHX installs:
 * inlined, that code was tree-shaken or would have failed to load.
 */
const resolutionMismatches = async (packageRoot: string, consumerRoot: string, graph: ModuleGraph): Promise<readonly string[]> => {
  const mismatches: string[] = []
  const check = async (specifier: string, dynamic: boolean): Promise<void> => {
    const fromConsumer = await resolvedPackage(specifier, consumerRoot)
    const fromStore = await resolvedPackage(specifier, packageRoot)
    if (fromConsumer === fromStore) return
    if (fromConsumer === undefined && !dynamic && fromStore !== undefined) return
    mismatches.push(`${specifier} (${fromConsumer ?? 'unresolved'} from the plugin, ${fromStore ?? 'unresolved'} from dshx)`)
  }
  await Promise.all([...graph.staticBare].map(specifier => check(specifier, false)))
  await Promise.all([...graph.dynamicBare].filter(specifier => !graph.staticBare.has(specifier)).map(specifier => check(specifier, true)))
  return mismatches.sort()
}

/** Snapshot the runtime for one consumer, or explain why the consumer must keep inlining it. */
const prepare = async (options: {
  readonly runtimeRoot: string
  readonly entries: readonly string[]
  readonly consumerRoot: string
}): Promise<RuntimeSnapshot | { readonly reason: string }> => {
  try {
    const runtimeRoot = await realpath(options.runtimeRoot).catch(() => unavailable(`runtime root ${options.runtimeRoot} is missing`))
    if (basename(runtimeRoot) !== 'dist') unavailable('dshx runs from source, not from its built dist')
    const packageRoot = dirname(runtimeRoot)
    if ((await readJson(DshxManifest, join(packageRoot, 'package.json'))) === undefined) {
      unavailable(`${packageRoot} is not a ${PACKAGE_NAME} package exporting ./${STORE_DIRECTORY}/*`)
    }
    const consumerRoot = await realpath(options.consumerRoot)
    if ((await resolvedPackage(PACKAGE_NAME, consumerRoot)) !== packageRoot)
      unavailable(`${PACKAGE_NAME} does not resolve from ${consumerRoot} to ${packageRoot}`)
    const entries = await Promise.all(options.entries.map(entry => realpath(entry).catch(() => unavailable(`runtime entry ${entry} is missing`))))
    const graph = await moduleGraph(runtimeRoot, entries)
    const mismatches = await resolutionMismatches(packageRoot, consumerRoot, graph)
    if (mismatches.length > 0) unavailable(`imports would load different packages: ${mismatches.join('; ')}`)
    const files = await snapshotFiles(packageRoot, runtimeRoot, graph)
    const hash = contentHash(files)
    const directory = await publish(join(packageRoot, STORE_DIRECTORY), hash, files)
    const specifiers = new Map(
      [...graph.modules.keys()].map(file => [file, `${PACKAGE_NAME}/${STORE_DIRECTORY}/${hash}/${relative(runtimeRoot, file).split(sep).join('/')}`]),
    )
    return { hash, directory, specifiers }
  } catch (cause) {
    if (cause instanceof SnapshotUnavailable) return { reason: cause.message }
    throw cause
  }
}

const referencedHashes = async (roots: readonly string[]): Promise<ReadonlySet<string>> => {
  const hashes = new Set<string>()
  const pattern = new RegExp(`${PACKAGE_NAME}/${STORE_DIRECTORY}/([0-9a-f]{20})/`, 'gu')
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async entry => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return entry.name === 'node_modules' ? undefined : visit(path)
        if (!entry.isFile() || !entry.name.endsWith('.js')) return undefined
        for (const match of (await readFile(path, 'utf8')).matchAll(pattern)) if (match[1] !== undefined) hashes.add(match[1])
        return undefined
      }),
    )
  }
  await Promise.all(roots.map(visit))
  return hashes
}

/**
 * Remove snapshots no built bundle under `referenceRoots` imports and that are older than the grace period. Every
 * module of a snapshot loads with the bundle that imports it, so a running Host never imports one lazily later: a
 * snapshot is only needed while some bundle on disk can still be (re)loaded, or a build is between publishing it and
 * writing its bundle (the grace period). Pass every directory holding Host bundles (plugin dist trees).
 */
const prune = async (options: {
  readonly storeRoot: string
  readonly referenceRoots: readonly string[]
  readonly graceMs?: number
  readonly now?: number
}): Promise<{ readonly removed: readonly string[]; readonly kept: readonly string[] }> => {
  const referenced = await referencedHashes(options.referenceRoots)
  const graceMs = options.graceMs ?? DEFAULT_PRUNE_GRACE_MS
  const now = options.now ?? Date.now()
  const removed: string[] = []
  const kept: string[] = []
  for (const entry of await readdir(options.storeRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    const directory = join(options.storeRoot, entry.name)
    const modified = (await stat(directory)).mtimeMs
    if (entry.name.startsWith('.staging-')) {
      if (now - modified > graceMs) await rm(directory, { recursive: true, force: true })
      continue
    }
    if (referenced.has(entry.name) || now - modified <= graceMs) {
      kept.push(entry.name)
      continue
    }
    await rm(directory, { recursive: true, force: true })
    removed.push(entry.name)
  }
  return { removed: removed.sort(), kept: kept.sort() }
}

/**
 * Externalize the DSHX runtime modules of a Host build to one shared snapshot. When the snapshot is unavailable for
 * this consumer the plugin stays inert and the runtime is inlined as before.
 */
const plugin = (options: {
  readonly runtimeRoot: string
  readonly entries: readonly string[]
  readonly consumerRoot: string
  readonly onOutcome: (outcome: RuntimeSnapshotOutcome) => void
}): Plugin & { readonly sourceFiles: () => readonly string[] } => {
  let snapshot: RuntimeSnapshot | undefined
  return {
    name: 'dshx-host-runtime-snapshot',
    enforce: 'pre',
    sourceFiles: () => (snapshot === undefined ? [] : [...snapshot.specifiers.keys()]),
    async buildStart() {
      const prepared = await prepare(options)
      snapshot = 'reason' in prepared ? undefined : prepared
      options.onOutcome('reason' in prepared ? { mode: 'inline', reason: prepared.reason } : { mode: 'snapshot', hash: prepared.hash })
    },
    async resolveId(source) {
      if (snapshot === undefined || !isAbsolute(source)) return null
      const real = await realpath(source).catch(() => source)
      const specifier = snapshot.specifiers.get(real)
      if (specifier !== undefined) return { id: specifier, external: true }
      if (isInside(dirname(snapshot.directory), real)) return null
      if (isInside(await realpath(options.runtimeRoot), real)) {
        throw new DshxError('DSHX1307', `The Host bundle imports DSHX runtime module ${real}, which is outside the runtime snapshot.`)
      }
      return null
    },
  }
}

export class HostRuntimeStore {
  static readonly prepare = prepare
  static readonly prune = prune
  static readonly plugin = plugin
}
