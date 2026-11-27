import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, relative } from 'node:path'
import type { Plugin, Rollup } from 'vite'
import { DshxError } from '../../diagnostics.js'
import { SharedRuntime } from './shared-runtime.js'

/**
 * `import()` targets become package-local lazy chunks that DSH fetches through `require.async("./client.<name>.js")`.
 * Each target is bundled on its own. A module the entry bundles too is not copied: the entry exports it in a table
 * (`__dshxLazyShared`) and the chunk reads it there through `require(<owner id>)`, which the DSH loader resolves to the
 * owner's already-run exports, so both run one instance. A target the entry also imports statically, or one that emits
 * an asset (CSS), stays inlined in `client.js`.
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
}

/** A module the entry hands its chunks: an ES module by its export names, a CommonJS one as its `module.exports`. */
export interface LazySharedModule {
  readonly id: string
  readonly names: readonly string[]
  readonly commonJs: boolean
}

/** Lazy-chunk decisions shared by one build and its retries; a watcher keeps them across rebuilds. */
export interface LazyChunkState {
  readonly fileNames: Map<string, string>
  readonly inline: Set<string>
  /** Shared modules by table key. */
  readonly shared: Map<string, LazySharedModule>
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
    return { fileNames: new Map(), inline: new Set(), shared: new Map(), emitted: new Set(), cache: new Map(), extraModules: [], retrying: false }
  }

  /** The source the entry appends so `require(<owner>).__dshxLazyShared[key]` resolves every shared module. */
  private static entryTable(shared: ReadonlyMap<string, LazySharedModule>): string {
    const modules = [...shared]
    const esm = modules.filter(([, module]) => !module.commonJs)
    const cjs = modules.some(([, module]) => module.commonJs)
    return [
      '',
      ...esm.map(([key], index) => `import * as __dshxLazyShared${index} from ${JSON.stringify(`${ENTRY_SHARED_PREFIX}${key}`)}`),
      ...(cjs ? [`import __dshxLazySharedCjs from ${JSON.stringify(ENTRY_CJS_TABLE)}`] : []),
      `export const ${SHARED_EXPORT} = Object.freeze({`,
      ...esm.map(([key], index) => `  ${JSON.stringify(key)}: __dshxLazyShared${index},`),
      ...(cjs ? ['  ...__dshxLazySharedCjs,'] : []),
      '})',
      '',
    ].join('\n')
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
        if (id !== options.entryId || state.shared.size === 0) return null
        return { code: `${code}${ClientLazyChunks.entryTable(state.shared)}`, map: null }
      },
      async resolveDynamicImport(source, importer) {
        if (typeof source !== 'string' || importer === undefined) return null
        const resolved = await this.resolve(source, importer, { skipSelf: true })
        if (resolved === null || resolved.external !== false || resolved.id.startsWith('\0') || !isAbsolute(resolved.id) || state.inline.has(resolved.id))
          return null
        let fileName = state.fileNames.get(resolved.id)
        if (fileName === undefined) {
          fileName = chunkFileName(options.root, resolved.id, await chunkHash(options.root, resolved.id))
          state.fileNames.set(resolved.id, fileName)
        }
        targets.set(resolved.id, fileName)
        return { id: `${MARKER}${fileName}`, external: true }
      },
      async generateBundle(_output, bundle) {
        const entry = Object.values(bundle).find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.isEntry)
        if (entry === undefined || targets.size === 0) return
        const entryModules = new Set(Object.keys(entry.modules))
        const sharedIds = new Set([...state.shared.values()].map(module => module.id))
        const built = new Map<string, LazyChunkBuild>()
        const retry: string[] = []
        const newlyShared: string[] = []
        for (const [id, fileName] of targets) {
          let chunk = state.cache.get(id)
          if (chunk === undefined) {
            chunk = await options.buildChunk(id, fileName)
            state.cache.set(id, chunk)
          }
          const shared = chunk.modules.filter(module => entryModules.has(module) && !isFacade(module))
          // The entry runs the target itself, or the target cannot be one chunk: keep it in client.js.
          if (chunk.unsupported !== undefined || entryModules.has(id) || shared.some(module => sharedIds.has(module))) {
            retry.push(id)
            continue
          }
          if (shared.length > 0) {
            for (const module of shared) {
              const info = this.getModuleInfo(module)
              state.shared.set(sharedKey(options.root, module), { id: module, names: info?.exports ?? [], commonJs: info?.inputFormat === 'cjs' })
            }
            state.cache.delete(id)
            newlyShared.push(id)
            continue
          }
          built.set(fileName, chunk)
        }
        if (retry.length > 0 || newlyShared.length > 0) {
          for (const id of retry) state.inline.add(id)
          state.retrying = !options.watch
          const named = (ids: readonly string[]): string => ids.map(id => relative(options.root, id)).join(', ')
          const what = [
            ...(retry.length > 0 ? [`lazy import() targets inlined: ${named(retry)}`] : []),
            ...(newlyShared.length > 0 ? [`entry modules shared with lazy chunks of ${named(newlyShared)}`] : []),
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
        const requireName = FACTORY_REQUIRE.exec(entry.code)?.[1] ?? 'require'
        entry.code = entry.code.replace(RENDERED_IMPORT, (_match, quote: string, fileName: string) => {
          const call = `${requireName}.async(`
          // Pad a minified require name back to the length of `require.async(` so rendered columns stay mapped.
          return `${call}${' '.repeat(Math.max(0, 'require.async('.length - call.length))}${quote}./${fileName}${quote})`
        })
        if (entry.code.includes(MARKER)) throw new DshxError('DSHX1101', 'A lazy import() target was rendered outside the DSH chunk protocol.')
      },
    }
  }

  /**
   * Chunk side: every module the entry shares becomes a facade over the owner's table. An ES facade copies the export
   * names once the owner has run (like the shared runtime's facades); a CommonJS facade re-exports the same
   * `module.exports`, so the chunk's own interop reads it exactly as the entry does.
   */
  static chunkPlugin(options: { readonly root: string; readonly state: LazyChunkState; readonly packageId: string }): Plugin {
    const { state } = options
    const keys = new Map([...state.shared].map(([key, module]) => [module.id, key]))
    const missing = (key: string): string =>
      `${options.packageId}: lazy chunk ran without its owner's shared module ${key}; load ${options.packageId} first, or rebuild it.`
    return {
      name: 'dshx-client-lazy-shared',
      enforce: 'pre',
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
  static chunkBuild(output: readonly (Rollup.OutputChunk | Rollup.OutputAsset)[], fileName: string): LazyChunkBuild {
    const chunks = output.filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
    const assets = output.filter((item): item is Rollup.OutputAsset => item.type === 'asset')
    const chunk = chunks.find(item => item.fileName === fileName)
    const map = assets.find(item => item.fileName === `${fileName}.map`)
    const modules = chunk === undefined ? [] : Object.entries(chunk.modules).flatMap(([id, module]) => (module.renderedLength > 0 ? [id] : []))
    const unexpected = assets.filter(item => item !== map && !item.fileName.endsWith('.js.map'))
    const unsupported =
      chunk === undefined || chunks.length !== 1
        ? 'it did not bundle into one chunk'
        : unexpected.length > 0
          ? `it emits ${unexpected.map(item => item.fileName).join(', ')}`
          : undefined
    return {
      code: chunk?.code ?? '',
      map: map === undefined ? (chunk?.map?.toString() ?? undefined) : typeof map.source === 'string' ? map.source : Buffer.from(map.source).toString('utf8'),
      modules,
      unsupported,
    }
  }
}
