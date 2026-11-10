import { createHash } from 'node:crypto'
import { basename, isAbsolute, relative } from 'node:path'
import type { Plugin, Rollup } from 'vite'
import { DshxError } from '../../diagnostics.js'
import { SharedRuntime } from './shared-runtime.js'

/**
 * `import()` targets become package-local lazy chunks that DSH fetches through `require.async("./client.<name>.js")`.
 * The DSH loader only runs self-contained chunks: a chunk may require externals, never the entry or another chunk, so
 * each target is bundled on its own and duplicates what it imports. A target whose bundle shares a module with the
 * entry would run a second copy of that module's state, so it stays inlined in `client.js`, as every target was before.
 */

/** Same length as `require.async("./`, so rewriting the rendered import keeps every source-map column after it. */
const MARKER = 'dshxlazy:'
const RENDERED_IMPORT = /import\((["'`])dshxlazy:(client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js)\1\)/g
const FACTORY_REQUIRE = /factory\s*:\s*\(?([\w$]+)\)?\s*=>/

/** One lazy chunk built on its own: its code, sourcemap and the modules it renders. */
export interface LazyChunkBuild {
  readonly code: string
  readonly map: string | undefined
  readonly modules: readonly string[]
  /** Why the target cannot load as a self-contained chunk; it is then inlined. */
  readonly unsupported: string | undefined
}

/** Lazy-chunk decisions shared by one build and its retries; a watcher keeps them across rebuilds. */
export interface LazyChunkState {
  readonly fileNames: Map<string, string>
  readonly inline: Set<string>
  readonly emitted: Set<string>
  readonly cache: Map<string, LazyChunkBuild>
  extraModules: readonly string[]
  /** Set while a build fails only to retry with more targets inlined, so its failure line is not reported. */
  retrying: boolean
}

const isNodeModule = (id: string): boolean => id.includes('/node_modules/')
/** Bundler helpers carry no module state, so each chunk may keep its own copy. */
const isBundlerHelper = (id: string): boolean => id.startsWith('\0rolldown/') || id.startsWith('\0vite/')

const chunkFileName = (root: string, id: string): string => {
  const path = id.replace(/[?#].*$/u, '')
  const stem =
    basename(path)
      .replace(/\.[^.]+$/u, '')
      .replace(/[^A-Za-z0-9._-]+/gu, '-')
      .replace(/^[^A-Za-z0-9]+/u, '') || 'chunk'
  const hash = createHash('sha256').update(relative(root, path)).digest('hex').slice(0, 8)
  return `client.${stem}.${hash}.js`
}

export class ClientLazyChunks {
  static state(): LazyChunkState {
    return { fileNames: new Map(), inline: new Set(), emitted: new Set(), cache: new Map(), extraModules: [], retrying: false }
  }

  static plugin(options: {
    readonly root: string
    readonly state: LazyChunkState
    readonly sourcemap: boolean
    readonly watch: boolean
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
      async resolveDynamicImport(source, importer) {
        if (typeof source !== 'string' || importer === undefined) return null
        const resolved = await this.resolve(source, importer, { skipSelf: true })
        if (resolved === null || resolved.external !== false || resolved.id.startsWith('\0') || !isAbsolute(resolved.id) || state.inline.has(resolved.id))
          return null
        let fileName = state.fileNames.get(resolved.id)
        if (fileName === undefined) {
          fileName = chunkFileName(options.root, resolved.id)
          state.fileNames.set(resolved.id, fileName)
        }
        targets.set(resolved.id, fileName)
        return { id: `${MARKER}${fileName}`, external: true }
      },
      async generateBundle(_output, bundle) {
        const entry = Object.values(bundle).find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.isEntry)
        if (entry === undefined || targets.size === 0) return
        const entryModules = new Set(Object.keys(entry.modules))
        const built = new Map<string, LazyChunkBuild>()
        const retry: string[] = []
        for (const [id, fileName] of targets) {
          let chunk = state.cache.get(id)
          if (chunk === undefined) {
            chunk = await options.buildChunk(id, fileName)
            state.cache.set(id, chunk)
          }
          const shared = chunk.modules.some(module => entryModules.has(module) && !SharedRuntime.isFacade(module) && !isBundlerHelper(module))
          if (chunk.unsupported !== undefined || shared) retry.push(id)
          else built.set(fileName, chunk)
        }
        if (retry.length > 0) {
          for (const id of retry) state.inline.add(id)
          state.retrying = !options.watch
          // A watcher cannot rebuild from inside its own generation; the next change picks the inlined targets up.
          throw options.watch
            ? new DshxError(
                'DSHX1105',
                `Lazy import() targets must be inlined: ${retry.map(id => relative(options.root, id)).join(', ')}. Save again to rebuild.`,
              )
            : new DshxError('DSHX1105', `Rebuilding with lazy import() targets inlined: ${retry.map(id => relative(options.root, id)).join(', ')}.`)
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
