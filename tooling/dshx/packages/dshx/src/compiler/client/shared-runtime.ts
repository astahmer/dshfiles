import * as Schema from 'effect/Schema'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'
import { DshxError } from '../../diagnostics.js'
import { decodeJson } from '../../json.js'
import { exportNames } from './export-names.js'

/** What the export-name probe prints: each importable specifier's sorted export names, and the ones Node could not import. */
const exportNamesSchema = Schema.Struct({ names: Schema.Record(Schema.String, Schema.Array(Schema.String)), failed: Schema.Array(Schema.String) })

/**
 * Opt-in shared runtime: one supplier package's Client chunk carries third-party modules and the shared plugin sheet
 * once, and every consumer resolves those modules through the DSH module table instead of inlining its own copy.
 * The supplier is an ordinary package row, so the Host loads it before any consumer that lists it in
 * `dsh.client.external`; a consumer whose CSS hash differs from the supplier's keeps injecting its own sheet.
 */
export class SharedRuntime {
  static readonly manifestFile = 'shared-runtime.json'
  static readonly exportName = 'sharedModules'
  private static readonly supplierModule = '\0dshx-shared-runtime'
  private static readonly facadePrefix = '\0dshx-shared:'

  /** A consumer facade only re-reads the supplier's table, so copies of it share the supplier's single instance. */
  static isFacade(id: string): boolean {
    return id.startsWith(SharedRuntime.facadePrefix)
  }

  /** The facade id the consumer plugin loads for one supplier table key. */
  static facadeId(key: string): string {
    return `${SharedRuntime.facadePrefix}${key}`
  }

  /** Supplier side: build the `sharedModules` table and record what it provides next to `client.js`. */
  static supplierPlugin(options: {
    readonly packageId: string
    readonly root: string
    readonly provide: readonly string[]
    readonly outDir: string
    readonly cssHash: () => string | undefined
    /** Modules served by key from a file rather than by specifier, such as stored DSHX Client runtime snapshots. */
    readonly keyedModules?: () => Promise<readonly { readonly key: string; readonly file: string; readonly names: readonly string[] }[]>
  }): Plugin {
    let modules: Readonly<Record<string, readonly string[]>> = {}
    let sources: readonly { readonly key: string; readonly request: string }[] = []
    /** Provided specifiers Node cannot import (TypeScript sources of a workspace kit): named from this build instead. */
    let unprobed: readonly string[] = []
    return {
      name: 'dshx-shared-runtime-supplier',
      enforce: 'pre',
      async buildStart() {
        const keyed = (await options.keyedModules?.()) ?? []
        const probed = await SharedRuntime.exportNames(options.root, options.provide)
        unprobed = probed.failed
        modules = {
          ...probed.names,
          ...Object.fromEntries(keyed.map(module => [module.key, module.names])),
        }
        sources = [
          ...options.provide.map(specifier => ({ key: specifier, request: specifier })),
          ...keyed.map(module => ({ key: module.key, request: module.file })),
        ]
      },
      async generateBundle() {
        if (unprobed.length === 0) return
        const built: Record<string, readonly string[]> = {}
        for (const specifier of unprobed) {
          const resolved = await this.resolve(specifier, resolve(options.root, 'package.json'))
          const names = resolved === null || resolved.external !== false ? undefined : await exportNames(this, resolved.id)
          if (names === undefined)
            throw new DshxError('DSHX1208', `Cannot read the export names of client.sharedRuntime.provide module ${JSON.stringify(specifier)}.`, {
              hint: 'Each provided module must be installed in the supplier and importable from Node, or be a source module this build compiles.',
            })
          built[specifier] = [...names].filter(name => name !== '__esModule').sort()
        }
        modules = { ...modules, ...built }
      },
      resolveId: source => (source === SharedRuntime.supplierModule ? source : null),
      load(id) {
        if (id !== SharedRuntime.supplierModule) return null
        const imports = sources.map((source, index) => `import * as module${index} from ${JSON.stringify(source.request)}`)
        const entries = sources.map((source, index) => `  ${JSON.stringify(source.key)}: module${index},`)
        return [...imports, `export const ${SharedRuntime.exportName} = Object.freeze({`, ...entries, '})', ''].join('\n')
      },
      async writeBundle() {
        const manifest = { supplier: options.packageId, modules, cssHash: options.cssHash() ?? null }
        await writeFile(resolve(options.outDir, SharedRuntime.manifestFile), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      },
    }
  }

  /**
   * Export names of each provided module, read by importing it in Node from the supplier root. Consumers re-export
   * exactly these names, so importing a name the module does not export fails the consumer build.
   */
  private static async exportNames(root: string, provide: readonly string[]): Promise<typeof exportNamesSchema.Type> {
    const script = `const specifiers = ${JSON.stringify(provide)}; const names = {}; const failed = []; for (const specifier of specifiers) { try { names[specifier] = Object.keys(await import(specifier)).filter(name => name !== '__esModule').sort() } catch { failed.push(specifier) } } process.stdout.write(JSON.stringify({ names, failed }))`
    try {
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
      return decodeJson(exportNamesSchema, stdout)
    } catch (cause) {
      throw new DshxError('DSHX1208', 'Cannot read the export names of every client.sharedRuntime.provide module.', {
        cause,
        hint: 'Each provided module must be installed in the supplier and importable from Node.',
      })
    }
  }

  /** Supplier side: the virtual entry re-exports the table so `require(supplier).sharedModules` resolves. */
  static supplierEntryExport(): string {
    return `export { ${SharedRuntime.exportName} } from ${JSON.stringify(SharedRuntime.supplierModule)}`
  }

  /** Consumer side: read the supplier's built manifest from the consumer's dependency graph. */
  static async readSupplier(options: {
    readonly root: string
    readonly supplier: string
    readonly external: readonly string[]
  }): Promise<{ readonly modules: ReadonlyMap<string, readonly string[]>; readonly cssHash: string | undefined }> {
    if (!options.external.includes(options.supplier)) {
      throw new DshxError('DSHX1208', `client.shared names ${JSON.stringify(options.supplier)}, but dsh.client.external does not request it.`, {
        hint: `Add ${JSON.stringify(options.supplier)} to dsh.client.external so the Host loads the supplier before this package.`,
      })
    }
    let manifestFile: string
    try {
      manifestFile = resolve(
        dirname(createRequire(resolve(options.root, 'package.json')).resolve(`${options.supplier}/package.json`)),
        'dist',
        SharedRuntime.manifestFile,
      )
    } catch (cause) {
      throw new DshxError('DSHX1208', `Shared-runtime supplier ${JSON.stringify(options.supplier)} is not resolvable from this package.`, {
        cause,
        hint: `Add ${JSON.stringify(options.supplier)} to dependencies (a workspace link is enough).`,
      })
    }
    const manifest: unknown = await readFile(manifestFile, 'utf8').then(JSON.parse, (cause: unknown) => {
      throw new DshxError('DSHX1208', `Shared-runtime supplier ${JSON.stringify(options.supplier)} has no built ${SharedRuntime.manifestFile}.`, {
        cause,
        file: manifestFile,
        hint: 'Build the supplier before its consumers.',
      })
    })
    const modules = typeof manifest === 'object' && manifest !== null && 'modules' in manifest ? manifest.modules : undefined
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('supplier' in manifest) ||
      manifest.supplier !== options.supplier ||
      typeof modules !== 'object' ||
      modules === null ||
      !Object.values(modules).every(names => Array.isArray(names) && names.every(name => typeof name === 'string'))
    ) {
      throw new DshxError('DSHX1208', `Shared-runtime manifest of ${JSON.stringify(options.supplier)} is malformed.`, {
        file: manifestFile,
        hint: 'Rebuild the supplier.',
      })
    }
    const cssHash = 'cssHash' in manifest && typeof manifest.cssHash === 'string' ? manifest.cssHash : undefined
    return { modules: new Map(Object.entries(modules as Record<string, readonly string[]>)), cssHash }
  }

  /**
   * Consumer side: resolve every provided module to a side-effect-free facade over the supplier's table. A provided
   * workspace source file (a kit component outside node_modules) is also matched when a relative import reaches it,
   * such as the kit's own `./ui/button.js` from a kit module the supplier does not provide.
   */
  static consumerPlugin(options: {
    readonly supplier: string
    readonly modules: ReadonlyMap<string, readonly string[]>
    readonly bundleDependencies: readonly string[]
    /** Where provided workspace files resolve from; without it only exact specifiers are matched. */
    readonly root?: string
    /** Filled with the provided workspace source files (file → specifier), which the provided-module guard reads. */
    readonly byFile?: Map<string, string>
  }): Plugin {
    const bundled = (source: string): boolean => options.bundleDependencies.some(dependency => source === dependency || source.startsWith(`${dependency}/`))
    const byFile = options.byFile ?? new Map<string, string>()
    return {
      name: 'dshx-shared-runtime-consumer',
      enforce: 'pre',
      async buildStart() {
        byFile.clear()
        if (options.root === undefined) return
        const from = resolve(options.root, 'package.json')
        for (const specifier of options.modules.keys()) {
          // DSHX Client runtime snapshot keys have their own consumer plugin.
          if (bundled(specifier) || specifier.startsWith('@dshfiles/dshx/')) continue
          const resolved = await this.resolve(specifier, from).catch(() => null)
          if (resolved !== null && resolved.external === false && isAbsolute(resolved.id) && !resolved.id.includes('/node_modules/')) byFile.set(resolved.id, specifier)
        }
      },
      async resolveId(source, importer, resolveOptions) {
        if (importer === undefined || importer.startsWith(SharedRuntime.facadePrefix) || bundled(source)) return null
        if (options.modules.has(source)) return `${SharedRuntime.facadePrefix}${source}`
        if (byFile.size === 0 || !source.startsWith('.')) return null
        const resolved = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true })
        const specifier = resolved === null ? undefined : byFile.get(resolved.id)
        return specifier === undefined ? null : `${SharedRuntime.facadePrefix}${specifier}`
      },
      load(id) {
        if (!id.startsWith(SharedRuntime.facadePrefix)) return null
        const specifier = id.slice(SharedRuntime.facadePrefix.length)
        const names = options.modules.get(specifier) ?? []
        return {
          code: [
            `import { ${SharedRuntime.exportName} } from ${JSON.stringify(options.supplier)}`,
            `const shared = ${SharedRuntime.exportName}[${JSON.stringify(specifier)}]`,
            `if (shared === undefined) throw new Error(${JSON.stringify(`${options.supplier} does not provide ${specifier}; rebuild the supplier, then this package.`)})`,
            ...names.map((name, index) => `const export${index} = shared[${JSON.stringify(name)}]`),
            `export { ${names.map((name, index) => `export${index} as ${JSON.stringify(name)}`).join(', ')} }`,
            '',
          ].join('\n'),
          moduleSideEffects: false,
        }
      },
    }
  }

  /** Consumer side: the entry requires the supplier even when no provided module survives tree-shaking, so its sheet is present. */
  static consumerEntryImport(supplier: string): string {
    return `import ${JSON.stringify(supplier)}`
  }
}
