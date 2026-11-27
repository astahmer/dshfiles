import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, relative } from 'node:path'
import type { Plugin, Rollup } from 'vite'
import { DshxError } from '../../diagnostics.js'
import { exportNames } from './export-names.js'
import { SharedRuntime } from './shared-runtime.js'

/**
 * `import()` targets become package-local lazy chunks that DSH fetches through `require.async("./client.<name>.js")`.
 * Each target is bundled on its own. A module the entry bundles too is not copied: the chunk imports it from a facade
 * over the entry's `__dshxLazyShared` table, which it reaches through `require(<owner id>)` (the DSH loader resolves
 * that to the owner's already-run exports), so both run one instance. The table binds only the names the chunks read,
 * so sharing a re-export hub (dshx's client module, plugin-ui/query) keeps the entry tree-shaken. A target the entry
 * also imports statically, or one that emits an asset (CSS), stays inlined in `client.js`.
 */

/** Same length as `require.async("./`, so rewriting the rendered import keeps every source-map column after it. */
const MARKER = 'dshxlazy:'
const RENDERED_IMPORT = /import\((["'`])dshxlazy:(client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js)\1\)/g
const FACTORY_REQUIRE = /factory\s*:\s*\(?([\w$]+)\)?\s*=>/
/** The entry export that hands shared modules to its chunks. */
const SHARED_EXPORT = '__dshxLazyShared'
/** Entry side: resolves to the shared module's real id, so the table imports the entry's own instance. */
const ENTRY_SHARED_PREFIX = '\0dshx-lazy-entry:'
/** Entry side: one CommonJS module whose exports are each shared CommonJS module's raw `module.exports`. */
const ENTRY_CJS_TABLE = '\0dshx-lazy-cjs-table'
/** Chunk side: a facade that reads one shared module from the owner's table. */
const CHUNK_SHARED_PREFIX = '\0dshx-lazy-shared:'
/** Chunk side: the owner package, external, which the DSH loader resolves to the entry's exports. */
const OWNER_SPECIFIER = '\0dshx-lazy-owner'

/** One lazy chunk built on its own: its code, sourcemap and the modules it renders. */
export interface LazyChunkBuild {
  readonly code: string
  readonly map: string | undefined
  readonly modules: readonly string[]
  /** Why the target cannot load as a self-contained chunk; it is then inlined. */
  readonly unsupported: string | undefined
  /** The names the chunk reads from each shared module, by table key. */
  readonly used: ReadonlyMap<string, readonly string[]>
  /** The chunk's own import() targets, each loaded as a sibling chunk: target id → chunk file. */
  readonly nested: ReadonlyMap<string, string>
}

/** A module the entry hands its chunks: an ES module by the names they read, a CommonJS one as its `module.exports`. */
export interface LazySharedModule {
  readonly id: string
  /** Every export name, so a chunk's facade links whatever its importers name. */
  readonly names: readonly string[]
  readonly commonJs: boolean
  /** Names some chunk reads: the only ones the entry binds. */
  readonly used: Set<string>
  /** The import() targets whose chunks read this module; it leaves the table when none is left. */
  readonly targets: Set<string>
}

/** Lazy-chunk decisions shared by one build and its retries; a watcher keeps them across rebuilds. */
export interface LazyChunkState {
  readonly fileNames: Map<string, string>
  readonly inline: Set<string>
  /** Shared modules by table key. */
  readonly shared: Map<string, LazySharedModule>
  /** What the current entry build's table binds, by key; a chunk reading more needs another entry build. */
  bound: ReadonlyMap<string, ReadonlySet<string>>
  readonly emitted: Set<string>
  readonly cache: Map<string, LazyChunkBuild>
  extraModules: readonly string[]
  /** Set while a build fails only to retry with more targets inlined, so its failure line is not reported. */
  retrying: boolean
}

const isNodeModule = (id: string): boolean => id.includes('/node_modules/')
/** Bundler helpers carry no module state, so each chunk may keep its own copy. */
const isBundlerHelper = (id: string): boolean => id.startsWith('\0rolldown/') || id.startsWith('\0vite/')
/** Modules a chunk may hold beside its entry: facades that read one shared instance, and stateless helpers. */
const isFacade = (id: string): boolean => SharedRuntime.isFacade(id) || id.startsWith(CHUNK_SHARED_PREFIX) || isBundlerHelper(id)

/** The chunk an import() target loads from (recorded in `state.fileNames`), or undefined when it stays inlined. */
const lazyTarget = async (
  context: Rollup.PluginContext,
  state: LazyChunkState,
  root: string,
  source: string,
  importer: string,
): Promise<{ readonly id: string; readonly fileName: string } | undefined> => {
  const resolved = await context.resolve(source, importer, { skipSelf: true })
  if (resolved === null || resolved.external !== false || resolved.id.startsWith('\0') || !isAbsolute(resolved.id) || state.inline.has(resolved.id))
    return undefined
  let fileName = state.fileNames.get(resolved.id)
  if (fileName === undefined) {
    fileName = chunkFileName(root, resolved.id, await chunkHash(root, resolved.id))
    state.fileNames.set(resolved.id, fileName)
  }
  return { id: resolved.id, fileName }
}

/** Turn each rendered `import("dshxlazy:<file>")` into the factory's `require.async("./<file>")`. */
const renderLazyImports = (code: string): string => {
  const requireName = FACTORY_REQUIRE.exec(code)?.[1] ?? 'require'
  return code.replace(RENDERED_IMPORT, (_match, quote: string, fileName: string) => {
    const call = `${requireName}.async(`
    // Pad a minified require name back to the length of `require.async(` so rendered columns stay mapped.
    return `${call}${' '.repeat(Math.max(0, 'require.async('.length - call.length))}${quote}./${fileName}${quote})`
  })
}

/** A stable table key: the module's path from the package root, hashed, so a key never leaks a machine path. */
const sharedKey = (root: string, id: string): string =>
  createHash('sha256')
    .update(isAbsolute(id) ? relative(root, id).replaceAll('\\', '/') : id)
    .digest('hex')
    .slice(0, 12)

const chunkFileName = (root: string, id: string, hash: string): string => {
  const path = id.replace(/[?#].*$/u, '')
  const stem =
    basename(path)
      .replace(/\.[^.]+$/u, '')
      .replace(/[^A-Za-z0-9._-]+/gu, '-')
      .replace(/^[^A-Za-z0-9]+/u, '') || 'chunk'
  return `client.${stem}.${hash}.js`
}

/**
 * The chunk name must change with the chunk's bytes: DSH serves plugin resources as immutable, so a name reused by
 * different content would leave a browser pinned to the old chunk.
 */
const chunkHash = async (root: string, id: string): Promise<string> => {
  const path = id.replace(/[?#].*$/u, '')
  try {
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
      .slice(0, 8)
  } catch {
    return createHash('sha256').update(relative(root, path)).digest('hex').slice(0, 8)
  }
}

export class ClientLazyChunks {
  static state(): LazyChunkState {
    return {
      fileNames: new Map(),
      inline: new Set(),
      shared: new Map(),
      bound: new Map(),
      emitted: new Set(),
      cache: new Map(),
      extraModules: [],
      retrying: false,
    }
  }

  /**
   * The source the entry appends so `require(<owner>).__dshxLazyShared[key]` resolves every shared module. ES names are
   * getters, so a chunk reads the binding's value when it loads, not when the entry ran.
   */
  private static entryTable(shared: ReadonlyMap<string, LazySharedModule>): string {
    const esm = [...shared].filter(([, module]) => !module.commonJs && module.used.size > 0)
    const cjs = [...shared].some(([, module]) => module.commonJs)
    const local = (index: number, slot: number): string => `__dshxLazy${index}_${slot}`
    return [
      '',
      ...esm.map(
        ([key, module], index) =>
          `import { ${[...module.used].map((name, slot) => `${JSON.stringify(name)} as ${local(index, slot)}`).join(', ')} } from ${JSON.stringify(`${ENTRY_SHARED_PREFIX}${key}`)}`,
      ),
      ...(cjs ? [`import __dshxLazySharedCjs from ${JSON.stringify(ENTRY_CJS_TABLE)}`] : []),
      `export const ${SHARED_EXPORT} = Object.freeze({`,
      ...esm.map(
        ([key, module], index) =>
          `  ${JSON.stringify(key)}: Object.freeze({ ${[...module.used].map((name, slot) => `get ${JSON.stringify(name)}() { return ${local(index, slot)} }`).join(', ')} }),`,
      ),
      ...(cjs ? ['  ...__dshxLazySharedCjs,'] : []),
      '})',
      '',
    ].join('\n')
  }

  /** A target that falls back to client.js stops holding its shared modules, so the entry stops binding them. */
  private static release(state: LazyChunkState, target: string): void {
    for (const [key, module] of state.shared) {
      module.targets.delete(target)
      if (module.targets.size === 0) state.shared.delete(key)
    }
  }

  static plugin(options: {
    readonly root: string
    readonly state: LazyChunkState
    readonly sourcemap: boolean
    readonly watch: boolean
    /** The virtual entry module that exports the shared table. */
    readonly entryId: string
    readonly buildChunk: (input: string, fileName: string) => Promise<LazyChunkBuild>
  }): Plugin {
    const { state } = options
    const targets = new Map<string, string>()
    return {
      name: 'dshx-client-lazy-chunks',
      enforce: 'post',
      buildStart() {
        targets.clear()
        state.emitted.clear()
        state.extraModules = []
        state.retrying = false
        if (options.watch) state.cache.clear()
      },
      resolveId(source) {
        if (source === ENTRY_CJS_TABLE) return source
        if (!source.startsWith(ENTRY_SHARED_PREFIX)) return null
        return state.shared.get(source.slice(ENTRY_SHARED_PREFIX.length))?.id ?? null
      },
      load(id) {
        if (id !== ENTRY_CJS_TABLE) return null
        const cjs = [...state.shared].filter(([, module]) => module.commonJs)
        return [
          'module.exports = {',
          ...cjs.map(([key, module]) => `  ${JSON.stringify(key)}: require(${JSON.stringify(module.id)}),`),
          '}',
          '',
        ].join('\n')
      },
      transform(code, id) {
        if (id !== options.entryId) return null
        state.bound = new Map([...state.shared].map(([key, module]) => [key, new Set(module.commonJs ? ['*'] : module.used)]))
        if (state.shared.size === 0) return null
        return { code: `${code}${ClientLazyChunks.entryTable(state.shared)}`, map: null }
      },
      async resolveDynamicImport(source, importer) {
        if (typeof source !== 'string' || importer === undefined) return null
        const target = await lazyTarget(this, state, options.root, source, importer)
        if (target === undefined) return null
        targets.set(target.id, target.fileName)
        return { id: `${MARKER}${target.fileName}`, external: true }
      },
      async generateBundle(_output, bundle) {
        const entry = Object.values(bundle).find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.isEntry)
        if (entry === undefined || targets.size === 0) return
        const entryModules = new Set(Object.keys(entry.modules))
        const sharedIn = (chunk: LazyChunkBuild): readonly string[] => chunk.modules.filter(module => entryModules.has(module) && !isFacade(module))
        const built = new Map<string, LazyChunkBuild>()
        const retry: string[] = []
        const rebind: string[] = []
        /** A chunk's own import() target → that chunk, and each chunk's modules, to keep a sibling from copying them. */
        const parents = new Map<string, string>()
        const chunkModules = new Map<string, ReadonlySet<string>>()
        const inline = (id: string): void => {
          retry.push(id)
          ClientLazyChunks.release(state, id)
          // A chunk that loads it as a sibling must be built again with it inlined.
          for (const [other, cached] of state.cache) if (cached.nested.has(id)) state.cache.delete(other)
        }
        for (const [id, fileName] of targets) {
          let chunk = state.cache.get(id)
          if (chunk === undefined) {
            chunk = await options.buildChunk(id, fileName)
            state.cache.set(id, chunk)
          }
          // The entry runs the target itself, or the target cannot be one chunk: keep it in client.js.
          if (chunk.unsupported !== undefined || entryModules.has(id)) {
            inline(id)
            continue
          }
          // A sibling chunk that bundles modules of the chunk loading it would run a second copy of them (Monaco's
          // language modules and its core): keep it inside that chunk.
          const parentModules = chunkModules.get(parents.get(id) ?? '')
          if (parentModules !== undefined && chunk.modules.some(module => parentModules.has(module) && !isFacade(module))) {
            inline(id)
            continue
          }
          const shared = sharedIn(chunk)
          if (shared.length > 0) {
            const described = await Promise.all(shared.map(async module => ({ module, names: await exportNames(this, module) })))
            // A star re-export of an external module has names only its runtime knows: keep that target in client.js.
            if (described.some(entry => entry.names === undefined)) {
              inline(id)
              continue
            }
            for (const { module, names } of described) {
              const key = sharedKey(options.root, module)
              const known = state.shared.get(key)
              if (known !== undefined) known.targets.add(id)
              else state.shared.set(key, { id: module, names: names ?? [], commonJs: this.getModuleInfo(module)?.inputFormat === 'cjs', used: new Set(), targets: new Set([id]) })
            }
            // Build it again over facades: what it reads from each is what the entry must bind.
            chunk = await options.buildChunk(id, fileName)
            state.cache.set(id, chunk)
            if (chunk.unsupported !== undefined || sharedIn(chunk).length > 0) {
              inline(id)
              continue
            }
          }
          for (const [key, names] of chunk.used) {
            const module = state.shared.get(key)
            if (module === undefined) continue
            module.targets.add(id)
            for (const name of names) module.used.add(name)
            const bound = state.bound.get(key)
            if (bound === undefined || (!module.commonJs && names.some(name => !bound.has(name)))) rebind.push(id)
          }
          // Its own import() targets load as sibling chunks; one it also bundles statically is inlined instead.
          chunkModules.set(id, new Set(chunk.modules))
          for (const [nested, nestedFile] of chunk.nested) {
            if (chunk.modules.includes(nested)) {
              state.inline.add(nested)
              state.cache.delete(id)
              rebind.push(id)
            } else if (!targets.has(nested)) {
              targets.set(nested, nestedFile)
              parents.set(nested, id)
            }
          }
          built.set(fileName, chunk)
        }
        if (retry.length > 0 || rebind.length > 0) {
          for (const id of retry) state.inline.add(id)
          state.retrying = !options.watch
          const named = (ids: readonly string[]): string => [...new Set(ids)].map(id => relative(options.root, id)).join(', ')
          const what = [
            ...(retry.length > 0 ? [`lazy import() targets inlined: ${named(retry)}`] : []),
            ...(rebind.length > 0 ? [`entry modules shared with lazy chunks of ${named(rebind)}`] : []),
          ].join('; ')
          // A watcher cannot rebuild from inside its own generation; the next change picks the new decisions up.
          throw options.watch
            ? new DshxError('DSHX1105', `Lazy chunks need another build (${what}). Save again to rebuild.`)
            : new DshxError('DSHX1105', `Rebuilding with ${what}.`)
        }
        const owners = new Map<string, string>()
        for (const [fileName, chunk] of built) {
          for (const module of chunk.modules) {
            if (isNodeModule(module) || module.startsWith('\0')) continue
            const owner = owners.get(module)
            if (owner !== undefined) {
              throw new DshxError(
                'DSHX1105',
                `Lazy chunks ${owner} and ${fileName} both bundle ${relative(options.root, module)}, so each would run its own copy.`,
                {
                  file: module,
                  hint: 'Import the shared module from one import() target, or import it statically from the entry.',
                },
              )
            }
            owners.set(module, fileName)
          }
        }
        for (const [fileName, chunk] of built) {
          const mapped = options.sourcemap && chunk.map !== undefined && !/\/\/# sourceMappingURL=\S+\s*$/u.test(chunk.code)
          const trailer = mapped ? `\n//# sourceMappingURL=${fileName}.map\n` : '\n'
          this.emitFile({ type: 'asset', fileName, source: `${chunk.code.trimEnd()}${trailer}` })
          state.emitted.add(fileName)
          if (options.sourcemap && chunk.map !== undefined) {
            this.emitFile({ type: 'asset', fileName: `${fileName}.map`, source: chunk.map })
            state.emitted.add(`${fileName}.map`)
          }
          if (options.watch) for (const module of chunk.modules) if (isAbsolute(module)) this.addWatchFile(module)
        }
        state.extraModules = [...built.values()].flatMap(chunk => chunk.modules)
        entry.code = renderLazyImports(entry.code)
        if (entry.code.includes(MARKER)) throw new DshxError('DSHX1101', 'A lazy import() target was rendered outside the DSH chunk protocol.')
      },
    }
  }

  /**
   * Chunk side: every module the entry shares becomes a facade over the owner's table. An ES facade copies the export
   * names once the owner has run (like the shared runtime's facades); a CommonJS facade re-exports the same
   * `module.exports`, so the chunk's own interop reads it exactly as the entry does.
   */
  static chunkPlugin(options: {
    readonly root: string
    readonly state: LazyChunkState
    readonly packageId: string
    /** Filled with the chunk's own import() targets. */
    readonly nested: Map<string, string>
  }): Plugin {
    const { state } = options
    const keys = new Map([...state.shared].map(([key, module]) => [module.id, key]))
    const missing = (key: string): string =>
      `${options.packageId}: lazy chunk ran without its owner's shared module ${key}; load ${options.packageId} first, or rebuild it.`
    return {
      name: 'dshx-client-lazy-shared',
      enforce: 'pre',
      buildStart() {
        options.nested.clear()
      },
      async resolveDynamicImport(source, importer) {
        if (typeof source !== 'string' || importer === undefined) return null
        const target = await lazyTarget(this, state, options.root, source, importer)
        if (target === undefined) return null
        options.nested.set(target.id, target.fileName)
        return { id: `${MARKER}${target.fileName}`, external: true }
      },
      async resolveId(source, importer, resolveOptions) {
        if (source === OWNER_SPECIFIER) return { id: options.packageId, external: true }
        if (keys.size === 0 || importer === undefined || importer.startsWith(CHUNK_SHARED_PREFIX)) return null
        const resolved = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true })
        const key = resolved === null || resolved.external !== false ? undefined : keys.get(resolved.id)
        return key === undefined ? null : `${CHUNK_SHARED_PREFIX}${key}`
      },
      load(id) {
        if (!id.startsWith(CHUNK_SHARED_PREFIX)) return null
        const key = id.slice(CHUNK_SHARED_PREFIX.length)
        const module = state.shared.get(key)
        if (module === undefined) return null
        const read = [
          `const table = require(${JSON.stringify(OWNER_SPECIFIER)})?.${SHARED_EXPORT}`,
          `if (table === undefined || table[${JSON.stringify(key)}] === undefined) throw new Error(${JSON.stringify(missing(key))})`,
        ]
        if (module.commonJs) return { code: [...read, `module.exports = table[${JSON.stringify(key)}]`, ''].join('\n'), moduleSideEffects: false }
        return {
          code: [
            `import * as owner from ${JSON.stringify(OWNER_SPECIFIER)}`,
            `const table = owner?.${SHARED_EXPORT}`,
            `if (table === undefined || table[${JSON.stringify(key)}] === undefined) throw new Error(${JSON.stringify(missing(key))})`,
            `const shared = table[${JSON.stringify(key)}]`,
            ...module.names.map((name, index) => `const export${index} = shared[${JSON.stringify(name)}]`),
            `export { ${module.names.map((name, index) => `export${index} as ${JSON.stringify(name)}`).join(', ')} }`,
            '',
          ].join('\n'),
          moduleSideEffects: false,
        }
      },
    }
  }

  /** Reduce one standalone Vite build of an import() target to the chunk the entry loads. */
  static chunkBuild(output: readonly (Rollup.OutputChunk | Rollup.OutputAsset)[], fileName: string, nested: ReadonlyMap<string, string> = new Map()): LazyChunkBuild {
    const chunks = output.filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
    const assets = output.filter((item): item is Rollup.OutputAsset => item.type === 'asset')
    const chunk = chunks.find(item => item.fileName === fileName)
    const map = assets.find(item => item.fileName === `${fileName}.map`)
    const modules = chunk === undefined ? [] : Object.entries(chunk.modules).flatMap(([id, module]) => (module.renderedLength > 0 ? [id] : []))
    const used = new Map(
      Object.entries(chunk?.modules ?? {}).flatMap(([id, module]) =>
        id.startsWith(CHUNK_SHARED_PREFIX) && module.renderedLength > 0 ? [[id.slice(CHUNK_SHARED_PREFIX.length), module.renderedExports] as const] : [],
      ),
    )
    const unexpected = assets.filter(item => item !== map && !item.fileName.endsWith('.js.map'))
    const code = renderLazyImports(chunk?.code ?? '')
    const unsupported =
      chunk === undefined || chunks.length !== 1
        ? 'it did not bundle into one chunk'
        : unexpected.length > 0
          ? `it emits ${unexpected.map(item => item.fileName).join(', ')}`
          : code.includes(MARKER)
            ? 'an import() was rendered outside the DSH chunk protocol'
            : undefined
    return {
      code,
      map: map === undefined ? (chunk?.map?.toString() ?? undefined) : typeof map.source === 'string' ? map.source : Buffer.from(map.source).toString('utf8'),
      modules,
      unsupported,
      used,
      nested: new Map(nested),
    }
  }
}
