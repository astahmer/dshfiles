import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { Plugin, Rollup } from 'vite'
import { z } from 'zod'
import { DshxError } from '../../diagnostics.js'
import { decodeJsonSafe } from '../../json.js'
import { containsPrivateDshxImport } from '../private-imports.js'

// util-values (pure partial-JSON argument reader, no dependencies or globals) was added for @dshfiles/turn-summary.
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|file-reference|session|llm|tools|brand|util-values)(\/|$)/
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/** Reject imports that cannot execute in a DSH browser bundle. */
function clientGuardPlugin(externals: ReadonlySet<string>, packageId: string, bundleDependencies: readonly string[] = []): Plugin {
  return {
    name: 'dshx-client-guards',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer !== undefined && (source.startsWith('node:') || isBuiltin(source))) {
        throw new DshxError('DSHX1201', `Node module ${JSON.stringify(source)} cannot be imported from a DSH Client entry.`, {
          file: importer,
          hint: 'Move this import to the Host entry.',
        })
      }
      if (
        !source.startsWith('@deepseek-ai/') ||
        externals.has(source) ||
        bundleDependencies.some(dependency => source === dependency || source.startsWith(`${dependency}/`))
      )
        return null
      if (INLINE_SAFE.test(source) || VENDORED_LIBRARY.test(source) || GENERATED_REMOTE.test(source)) return null
      throw new DshxError('DSHX1202', `Client import ${JSON.stringify(source)} is neither a DSH baseline module nor a declared module request.`, {
        ...(importer !== undefined && { file: importer }),
        hint: `Declare the exact specifier in ${packageId}'s dsh.client.external or use a Cordis service.`,
      })
    },
  }
}

const namedManifestSchema = z.looseObject({ name: z.string() })

const packageNameOf = (specifier: string): string =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/')

/**
 * Fail when the final chunk carries code from a package the page already loads: a DSH platform module, a DSH package the
 * Host loads through `dsh.client.external` or `dsh.client.inject`, or a module of the configured shared runtime.
 * Externals match exact specifiers, so a subpath or a dependency's deep import of the same package is silently
 * bundled; the copy then runs beside the loaded one with its own module state (a second React, a second QueryClient
 * context). Matching by owning package catches every route in. `bundleDependencies` is the explicit opt-in.
 */
function providedModuleGuardPlugin(options: {
  readonly root: string
  readonly packageId: string
  /** Module specifier the page provides, with the reason it does. */
  readonly provided: ReadonlyMap<string, string>
  readonly bundleDependencies: readonly string[]
}): Plugin {
  const bundled = new Set(options.bundleDependencies.map(packageNameOf))
  const provided = new Map<string, string>()
  for (const [specifier, reason] of options.provided) {
    const name = packageNameOf(specifier)
    if (name !== options.packageId && !bundled.has(name) && !provided.has(name)) provided.set(name, reason)
  }
  const owners = new Map<string, Promise<string | undefined>>()
  const owningPackage = (directory: string): Promise<string | undefined> => {
    const cached = owners.get(directory)
    if (cached !== undefined) return cached
    const lookup = readFile(resolve(directory, 'package.json'), 'utf8').then(
      text => {
        try {
          const manifest = decodeJsonSafe(namedManifestSchema, text)
          return manifest.success ? manifest.data.name : parentPackage(directory)
        } catch {
          return parentPackage(directory)
        }
      },
      () => parentPackage(directory),
    )
    owners.set(directory, lookup)
    return lookup
  }
  const parentPackage = (directory: string): Promise<string | undefined> =>
    dirname(directory) === directory ? Promise.resolve(undefined) : owningPackage(dirname(directory))
  const display = (id: string): string => {
    if (id.startsWith('\0')) return id.slice(1)
    const nested = id.lastIndexOf('/node_modules/')
    return nested === -1 ? relative(options.root, id) : id.slice(nested + 1)
  }
  return {
    name: 'dshx-client-provided-modules',
    enforce: 'post',
    async generateBundle(_output, bundle) {
      const chunk = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry)
      if (chunk === undefined || chunk.type !== 'chunk' || provided.size === 0) return
      const offenders: Array<{ readonly id: string; readonly name: string }> = []
      for (const [id, module] of Object.entries(chunk.modules)) {
        if (module.renderedLength === 0 || !isAbsolute(id)) continue
        const name = await owningPackage(dirname(id))
        if (name !== undefined && provided.has(name)) offenders.push({ id, name })
      }
      const first = offenders[0]
      if (first === undefined) return
      const reached = new Map<string, string | undefined>([[first.id, undefined]])
      const queue = [first.id]
      let entry: string | undefined
      while (entry === undefined && queue.length > 0) {
        const id = queue.shift()!
        const info = this.getModuleInfo(id)
        if (info === null || info.isEntry) {
          entry = id
          break
        }
        for (const importer of [...info.importers, ...info.dynamicImporters]) {
          if (reached.has(importer)) continue
          reached.set(importer, id)
          queue.push(importer)
        }
      }
      const chain: string[] = []
      for (let id = entry; id !== undefined; id = reached.get(id)) chain.push(display(id))
      const packages = [...new Set(offenders.map(offender => offender.name))]
      throw new DshxError(
        'DSHX1209',
        `Client bundle includes ${packages.map(name => JSON.stringify(name)).join(', ')}, which the page already loads: ${provided.get(first.name)}.\nImport chain: ${chain.join(' -> ')}`,
        {
          file: first.id,
          hint: `Import the provided specifier exactly, so it stays external, or stop importing ${JSON.stringify(first.name)}. When a private copy is intended, list it in client.bundleDependencies with a comment saying why.`,
        },
      )
    },
  }
}

/** Fail when a build violates the selected DSH client bundle protocol. */
function singleClientChunkPlugin(): Plugin {
  const validate = (bundle: Rollup.OutputBundle): void => {
    const chunks = Object.values(bundle).filter(output => output.type === 'chunk')
    const assets = Object.values(bundle).filter(output => output.type === 'asset')
    if (chunks.length !== 1 || chunks[0]?.isEntry !== true) {
      throw new DshxError('DSHX1101', 'A DSH Client build must emit exactly one JavaScript entry chunk.')
    }
    const chunk = chunks[0]
    const requiredExports = ['Config', 'apply', 'inject', 'name']
    const missingExports = requiredExports.filter(name => !chunk.exports.includes(name))
    // Client output is minified, so identifiers like `require`/`module`/`exports` may be renamed.
    const hasLoader = /window\.__ModuleLoader__\.load\(\{\s*id\s*:/.test(chunk.code)
    const hasFactory = /factory\s*:\s*\(?[\w$]+\)?\s*=>\s*\{/.test(chunk.code)
    const hasReturn = /[\w$]+\.exports\s*;?\s*\}\s*\}\s*\)\s*;?/.test(chunk.code)
    const missingAssignments = requiredExports.filter(name => !new RegExp(`[\\w$]\\.${name}\\s*=`).test(chunk.code))
    if (missingExports.length > 0 || missingAssignments.length > 0 || !hasLoader || !hasFactory || !hasReturn) {
      throw new DshxError('DSHX1101', 'A Vite plugin corrupted the DSH lazy Client factory protocol.', {
        hint: `Preserve the ModuleLoader wrapper and the ${requiredExports.join(', ')} exports; avoid replacing the final chunk in renderChunk/generateBundle.`,
      })
    }
    if (containsPrivateDshxImport(chunk.code)) {
      throw new DshxError('DSHX1101', 'The DSH Client artifact retained a private DSHX runtime import.')
    }
    const unexpectedAssets = assets.filter(asset => !asset.fileName.endsWith('.js.map'))
    if (unexpectedAssets.length > 0) {
      throw new DshxError('DSHX1102', `A DSH Client build emitted unsupported assets: ${unexpectedAssets.map(asset => asset.fileName).join(', ')}.`)
    }
  }
  return {
    name: 'dshx-single-client-chunk',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        validate(bundle)
      },
    },
  }
}

export class ClientCompilerGuards {
  static readonly clientGuardPlugin = clientGuardPlugin
  static readonly providedModuleGuardPlugin = providedModuleGuardPlugin
  static readonly singleClientChunkPlugin = singleClientChunkPlugin
}
