import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { decodeJsonSafe } from '@dshfiles/dshx/json'
import { withSpan } from '@dshfiles/dshx/tracing'
import { Option } from 'effect'
import * as Schema from 'effect/Schema'

/**
 * Replaces one opted-in plugin's Host half inside the running DSH: the Loader row keeps its id and config, the plugin's
 * own modules are evaluated again, the previous Cordis fiber is disposed, and the new one starts in the same Loader
 * entry. It mirrors what `@deepseek-ai/dsh-hmr` does for a whole watched tree, restricted to one package and with the
 * previous code kept until the replacement imported and passed its Loader contract check.
 */

/** `no-module-namespace`: cordis-plugin-loader before 1.0.6 does not keep the Entry's imported module, so the running plugin cannot be identified for rollback. */
export type HostReloadRefusal = 'no-loader' | 'no-module-cache' | 'no-module-namespace' | 'entry-not-found' | 'contract-changed'

export type HostReloadOutcome =
  | { readonly kind: 'reloaded'; readonly evicted: number; readonly durationMs: number }
  | { readonly kind: 'refused'; readonly reason: HostReloadRefusal }
  | { readonly kind: 'failed'; readonly reason: 'import-failed' | 'activation-failed'; readonly restored: boolean; readonly message: string }

/** What the gate needs from an owned package: its name (the Loader row's `name`) and its opt-in. */
const optInManifestSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  dshx: Schema.optional(Schema.Struct({ hostReload: Schema.optional(Schema.Literal('safe')) })),
})

/** A running fiber, as far as a swap needs it. */
interface SwapFiber {
  await(): Promise<unknown>
  dispose(): unknown
}

/** One Loader row: `@deepseek-ai/cordis-plugin-loader`'s `Entry`, narrowed to the fields `Entry._init` itself sets. */
interface ReloadEntry {
  readonly ctx: Context
  readonly options: { readonly name: string; readonly config?: unknown }
  fiber: SwapFiber | undefined
  moduleNamespace: unknown
}

interface ReloadLoader {
  entries(): Iterable<ReloadEntry>
  unwrapExports(value: unknown): unknown
}

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

/** The plugin shapes `registry.plugin` accepts: a function, or an object with `apply`. */
const isPlugin = (value: unknown): value is Plugin => typeof value === 'function' || (isObject(value) && 'apply' in value && typeof value.apply === 'function')

const loaderSchema = Schema.declare<ReloadLoader>(
  (value): value is ReloadLoader =>
    isObject(value) && 'entries' in value && typeof value.entries === 'function' && 'unwrapExports' in value && typeof value.unwrapExports === 'function',
)

/**
 * Node's ESM `LoadCache` as `cordis-plugin-loader`'s `ModuleLoader.fromInternal()` exposes it. It extends the
 * primordial `SafeMap`, whose prototype is a copy, so it fails `instanceof Map` but carries the Map internal slot.
 */
const hasMapSlot = (value: unknown): value is Map<unknown, unknown> => {
  try {
    Map.prototype.has.call(value, undefined)
    return true
  } catch {
    return false
  }
}

const moduleCacheSchema = Schema.Struct({ internal: Schema.Struct({ loadCache: Schema.declare(hasMapSlot) }) })

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500)

/** The package directory that owns a Host artifact (`dist/index.js` → package root). */
const packageRootOf = (hostPath: string): string | undefined => {
  let directory = dirname(hostPath)
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      readFileSync(join(directory, 'package.json'))
      return directory
    } catch {
      const parent = dirname(directory)
      if (parent === directory) return undefined
      directory = parent
    }
  }
  return undefined
}

/** The package's name when its manifest opts its Host half into in-process reload, read fresh on every rebuild. */
const optedInPackage = (hostPath: string): string | undefined => {
  const root = packageRootOf(hostPath)
  if (root === undefined) return undefined
  let raw: string
  try {
    raw = readFileSync(join(root, 'package.json'), 'utf8')
  } catch {
    return undefined
  }
  const manifest = decodeJsonSafe(optInManifestSchema, raw)
  if (manifest._tag !== 'Success') return undefined
  return manifest.success.dshx?.hostReload === 'safe' ? manifest.success.name : undefined
}

/**
 * The Loader-visible contract: a changed `name`, `inject` or `Config` cannot be applied to a running row, because
 * the Loader resolved injections and decoded the row config against the old values. `Config` compares by its JSON
 * form when the schema has one (Schemastery), otherwise by presence only, as `dshx`'s Host generations do.
 */
const pluginContractSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  inject: Schema.optional(Schema.Unknown),
  Config: Schema.optional(Schema.Unknown),
})

const contractOf = (plugin: Plugin): string => {
  const fields = Schema.decodeUnknownOption(pluginContractSchema)(plugin)
  if (Option.isNone(fields)) return JSON.stringify([typeof plugin === 'function' ? plugin.name : 'invalid', null, 'none'])
  const config = fields.value.Config
  let configShape: string
  try {
    configShape = config === undefined ? 'none' : (JSON.stringify(config) ?? 'present')
  } catch {
    configShape = 'present'
  }
  return JSON.stringify([fields.value.name, fields.value.inject ?? null, configShape])
}

/** The ESM cache keys of one package's own files; shared runtime modules and dependencies stay loaded. */
const packageUrls = (loadCache: Map<unknown, unknown>, packageRoot: string): readonly string[] => {
  const prefix = `${pathToFileURL(packageRoot).href}/`
  const urls: string[] = []
  for (const key of Map.prototype.keys.call(loadCache)) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue
    if (key.slice(prefix.length).startsWith('node_modules/')) continue
    urls.push(key)
  }
  return urls
}

/** Remove whole `LoadCache` entries (Node's own `delete` clears one type slot only); returns the restore. */
const evict = (loadCache: Map<unknown, unknown>, urls: readonly string[]): (() => void) => {
  const backup = new Map<string, unknown>()
  for (const url of urls) {
    backup.set(url, Map.prototype.get.call(loadCache, url))
    Map.prototype.delete.call(loadCache, url)
  }
  return () => {
    for (const [url, job] of backup) Map.prototype.set.call(loadCache, url, job)
  }
}

const settle = async (fiber: SwapFiber | undefined): Promise<void> => {
  await fiber?.await().catch(() => undefined)
}

/** Start `plugin` as the entry's fiber, the way `Entry._init` does, and wait for it to activate. */
const activate = async (entry: ReloadEntry, plugin: Plugin, moduleNamespace: unknown): Promise<void> => {
  const fiber: SwapFiber = entry.ctx.registry.plugin(plugin, entry.options.config).ctx.fiber
  entry.fiber = fiber
  entry.moduleNamespace = moduleNamespace
  await fiber.await()
}

const reload = (ctx: Context, hostPath: string, packageName: string): Promise<HostReloadOutcome> =>
  withSpan('host-reload apply', { attributes: { 'dshfiles.plugin.package': packageName } }, async span => {
    const started = performance.now()
    const loader = Schema.decodeUnknownOption(loaderSchema)(ctx.get('loader'))
    if (Option.isNone(loader)) return { kind: 'refused', reason: 'no-loader' }
    const cache = Schema.decodeUnknownOption(moduleCacheSchema)(loader.value)
    if (Option.isNone(cache)) return { kind: 'refused', reason: 'no-module-cache' }
    const entries = [...loader.value.entries()].filter(entry => entry.options.name === packageName && entry.fiber !== undefined)
    const entry = entries.length === 1 ? entries[0] : undefined
    if (entry === undefined) return { kind: 'refused', reason: 'entry-not-found' }
    const packageRoot = packageRootOf(hostPath)
    if (packageRoot === undefined) return { kind: 'refused', reason: 'entry-not-found' }

    const loadCache = cache.value.internal.loadCache
    const previousNamespace = entry.moduleNamespace
    const previousPlugin = loader.value.unwrapExports(previousNamespace)
    if (previousNamespace === undefined || !isPlugin(previousPlugin)) return { kind: 'refused', reason: 'no-module-namespace' }
    const urls = packageUrls(loadCache, packageRoot)
    const restoreCache = evict(loadCache, urls)
    span.setAttribute('dshfiles.host_reload.evicted', urls.length)

    let nextNamespace: unknown
    try {
      nextNamespace = await import(pathToFileURL(hostPath).href)
    } catch (error) {
      restoreCache()
      return { kind: 'failed', reason: 'import-failed', restored: true, message: errorMessage(error) }
    }
    const nextPlugin = loader.value.unwrapExports(nextNamespace)
    if (!isPlugin(nextPlugin) || contractOf(nextPlugin) !== contractOf(previousPlugin)) {
      restoreCache()
      return { kind: 'refused', reason: 'contract-changed' }
    }

    // `registry.delete` drops the runtime before disposing its fibers, so the Loader's `internal/plugin` hook does not
    // mistake the swap for a user unload and persist `disabled: true` into the profile (cordis-plugin-loader index.js).
    const previousFiber = entry.fiber
    entry.ctx.registry.delete(previousPlugin)
    await settle(previousFiber)
    try {
      await activate(entry, nextPlugin, nextNamespace)
    } catch (error) {
      const message = errorMessage(error)
      entry.ctx.registry.delete(nextPlugin)
      await settle(entry.fiber)
      restoreCache()
      const restored = await activate(entry, previousPlugin, previousNamespace).then(
        () => true,
        () => false,
      )
      return { kind: 'failed', reason: 'activation-failed', restored, message }
    }
    return { kind: 'reloaded', evicted: urls.length, durationMs: Math.round(performance.now() - started) }
  })

export class HostReload {
  static readonly optedInPackage = optedInPackage
  static readonly reload = reload
  static readonly contractOf = contractOf
  static readonly packageUrls = packageUrls
}
