import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { decodeJson, jsonValueSchema } from '../json.js'

export class CheckoutSyncError extends Error {
  readonly code: string
  readonly hint: string
  constructor(code: string, message: string, hint: string) {
    super(message)
    this.name = 'CheckoutSyncError'
    this.code = code
    this.hint = hint
  }
}

export interface PluginEffect {
  readonly name: string
  /** Its Host bundle, manifest or bundle patch changed: only a DSH restart loads it. */
  readonly host: boolean
  /** Its client bundle changed: DSH hot-reloads it. */
  readonly client: boolean
}

export interface RebuildPlan {
  /** Directories, relative to the checkout, whose pnpm lockfile changed. */
  readonly installRoots: readonly string[]
  readonly dshx: boolean
  /** Plugin packages to rebuild, with the effect predicted from their previous build's source maps. */
  readonly plugins: readonly PluginEffect[]
  readonly profileChanged: boolean
}

const PLUGINS_DIRECTORY = 'plugins'
const DSHX_WORKSPACE = 'tooling/dshx'
const PROFILE_SEED = 'profiles/'
const OUTPUT_TAIL = 4_000

const manifestSchema = z.object({
  name: z.string(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  dsh: z.object({ client: z.unknown().optional() }).optional(),
})
const sourceMapSchema = z.object({ sources: z.array(z.string()) })
const dependencyManifestSchema = z.object({ version: z.literal(1), sources: z.array(z.string()) })

interface PluginPackage {
  readonly name: string
  readonly directory: string
  readonly workspaceDependencies: readonly string[]
  /** Read on demand: an unchanged checkout never needs to know which files a bundle inlined. */
  readonly hostSources: () => ReadonlySet<string>
  readonly clientSources: () => ReadonlySet<string>
  readonly missingHostBundle: boolean
  readonly missingClientBundle: boolean
}

/** Tests, docs and catalogs never reach a build's output. */
const isBuildInput = (path: string): boolean => !/\.md$|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(tests?|docs|e2e)\/|(^|\/)dshx\.features\.json$/.test(path)

const memoizedSources = (read: () => ReadonlySet<string>): (() => ReadonlySet<string>) => {
  let cached: ReadonlySet<string> | undefined
  return () => (cached ??= read())
}

/**
 * Checkout-relative paths of the sources a bundle's previous build was made from, read from the
 * compact dependency manifest the compiler emits next to the bundle. A bundle without one (an
 * older artifact) falls back to its source map, which is much larger because it carries every
 * source's contents.
 */
const bundledSources = (root: string, directory: string, bundle: string): ReadonlySet<string> => {
  const distDirectory = join(root, directory, 'dist')
  const manifestPath = join(distDirectory, `${bundle}.js.deps.json`)
  if (existsSync(manifestPath)) {
    const manifest = dependencyManifestSchema.safeParse(decodeJson(jsonValueSchema, readFileSync(manifestPath, 'utf8')))
    if (manifest.success) return new Set(manifest.data.sources.map(source => relative(root, resolve(join(root, directory), source))))
  }
  const mapPath = join(distDirectory, `${bundle}.js.map`)
  if (!existsSync(mapPath)) return new Set()
  const parsed = sourceMapSchema.safeParse(decodeJson(jsonValueSchema, readFileSync(mapPath, 'utf8')))
  if (!parsed.success) return new Set()
  return new Set(parsed.data.sources.map(source => relative(root, resolve(dirname(mapPath), source))))
}

const readPluginPackages = (root: string): readonly PluginPackage[] => {
  const pluginsRoot = join(root, PLUGINS_DIRECTORY)
  if (!existsSync(pluginsRoot)) return []
  const packages: PluginPackage[] = []
  for (const scope of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!scope.isDirectory() || !scope.name.startsWith('@')) continue
    for (const entry of readdirSync(join(pluginsRoot, scope.name), { withFileTypes: true })) {
      const directory = join(PLUGINS_DIRECTORY, scope.name, entry.name)
      const manifestPath = join(root, directory, 'package.json')
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue
      const manifest = manifestSchema.safeParse(decodeJson(jsonValueSchema, readFileSync(manifestPath, 'utf8')))
      if (!manifest.success || manifest.data.scripts?.build === undefined) continue
      const distDirectory = join(root, directory, 'dist')
      const hasClientBundle = manifest.data.dsh?.client !== undefined
      packages.push({
        name: manifest.data.name,
        directory,
        workspaceDependencies: Object.entries({ ...manifest.data.dependencies, ...manifest.data.devDependencies })
          .filter(([, spec]) => spec.startsWith('workspace:'))
          .map(([name]) => name),
        hostSources: memoizedSources(() => bundledSources(root, directory, 'index')),
        clientSources: memoizedSources(() => bundledSources(root, directory, 'client')),
        missingHostBundle: !existsSync(join(distDirectory, 'index.js')),
        missingClientBundle: hasClientBundle && !existsSync(join(distDirectory, 'client.js')),
      })
    }
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name))
}

/** dshx builds `src/<path>.ts` to `dist/<path>.js`, which is what a plugin bundle's source map names. */
const dshxDistributionOf = (path: string): string | undefined => {
  const match = /^(tooling\/dshx\/packages\/[^/]+)\/src\/(.+)\.ts$/.exec(path)
  return match === null ? undefined : `${match[1]}/dist/${match[2]}.js`
}

/**
 * What a checkout needs after its base moved from one main to the next: installs where a lockfile changed, a dshx
 * rebuild when dshx changed, and the plugins whose sources changed plus every plugin that depends on them (a plugin-ui
 * class change only dedupes once every dependant is rebuilt) or bundles a changed dshx runtime file. Missing plugin bundle
 * outputs are selected independently so an up-to-date checkout can repair its generated artifacts without rebuilding dependants.
 */
const planRebuild = (input: { readonly root: string; readonly changedFiles: readonly string[] }): RebuildPlan => {
  const changed = input.changedFiles.filter(isBuildInput)
  const packages = readPluginPackages(input.root)
  const owns = (pluginPackage: PluginPackage, path: string): boolean => path.startsWith(`${pluginPackage.directory}/`)
  const dshxOutputs = new Set(changed.flatMap(path => dshxDistributionOf(path) ?? []))

  const changedPackages = new Set(
    packages
      .filter(
        pluginPackage =>
          changed.some(path => owns(pluginPackage, path)) ||
          (dshxOutputs.size > 0 && [...dshxOutputs].some(output => pluginPackage.hostSources().has(output) || pluginPackage.clientSources().has(output))),
      )
      .map(pluginPackage => pluginPackage.name),
  )
  const dependencyAffected = new Set(changedPackages)
  for (let grew = true; grew;) {
    grew = false
    for (const pluginPackage of packages) {
      if (dependencyAffected.has(pluginPackage.name) || !pluginPackage.workspaceDependencies.some(name => dependencyAffected.has(name))) continue
      dependencyAffected.add(pluginPackage.name)
      grew = true
    }
  }
  const selected = new Set([
    ...dependencyAffected,
    ...packages.filter(pluginPackage => pluginPackage.missingHostBundle || pluginPackage.missingClientBundle).map(pluginPackage => pluginPackage.name),
  ])

  const changedSet = new Set(changed)
  // Nothing changed, so no bundle's source list can match: skip reading its manifest or source map.
  const comparesSources = changedSet.size > 0 || dshxOutputs.size > 0
  const plugins = packages
    .filter(pluginPackage => selected.has(pluginPackage.name))
    .map(pluginPackage => {
      const own = changed.filter(path => owns(pluginPackage, path))
      const manifestChanged = own.some(path => /\/(package\.json|cordis\.patch\.yml)$/.test(path))
      const unmapped = own.some(path => /\.[cm]?[jt]sx?$/.test(path) && !pluginPackage.hostSources().has(path) && !pluginPackage.clientSources().has(path))
      const hits = (sources: () => ReadonlySet<string>): boolean =>
        comparesSources && [...sources()].some(source => changedSet.has(source) || dshxOutputs.has(source))
      // A source the last build never saw could land in either bundle; assume the Host so a restart is not missed.
      const host = pluginPackage.missingHostBundle || manifestChanged || unmapped || hits(pluginPackage.hostSources)
      return { name: pluginPackage.name, host, client: pluginPackage.missingClientBundle || !host || hits(pluginPackage.clientSources) }
    })

  const installRoots = [...new Set(input.changedFiles.filter(path => /(^|\/)pnpm-lock\.yaml$/.test(path)).map(path => dirname(path)))].sort((left, right) =>
    left === '.' ? -1 : right === '.' ? 1 : left.localeCompare(right),
  )
  return {
    installRoots,
    dshx: changed.some(path => path.startsWith(`${DSHX_WORKSPACE}/packages/`)),
    plugins,
    profileChanged: input.changedFiles.some(path => path.startsWith(PROFILE_SEED)),
  }
}

const fingerprint = (path: string): string | null => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null)

const runCommand = (input: {
  readonly argv: readonly [string, ...string[]]
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly onOutput?: ((chunk: string) => void) | undefined
}): Promise<{ readonly exitCode: number; readonly output: string }> =>
  new Promise(resolvePromise => {
    const [command, ...args] = input.argv
    const child = spawn(command, args, { cwd: input.cwd, env: input.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      output = (output + text).slice(-OUTPUT_TAIL)
      input.onOutput?.(text)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', error => resolvePromise({ exitCode: 127, output: `${output}${error.message}` }))
    child.on('close', code => resolvePromise({ exitCode: code ?? 1, output }))
  })

export interface RebuildOutcome {
  readonly installed: readonly string[]
  readonly dshx: boolean
  readonly plugins: readonly PluginEffect[]
  readonly failure: { readonly step: string; readonly command: string; readonly output: string } | null
}

/** Installs, then dshx (plugins build with it), then the selected plugins in dependency order. */
const runRebuild = async (input: {
  readonly root: string
  readonly plan: RebuildPlan
  readonly changedFiles: readonly string[]
  readonly onProgress?: ((message: string) => void) | undefined
  readonly onOutput?: ((chunk: string) => void) | undefined
}): Promise<RebuildOutcome> => {
  const installed: string[] = []
  const step = async (name: string, argv: readonly [string, ...string[]], cwd: string, env?: NodeJS.ProcessEnv) => {
    input.onProgress?.(`${name}: ${argv.join(' ')}`)
    const result = await runCommand({ argv, cwd, env, onOutput: input.onOutput })
    return result.exitCode === 0 ? null : { step: name, command: `(cd ${cwd} && ${argv.join(' ')})`, output: result.output }
  }

  for (const directory of input.plan.installRoots) {
    // The desktop app's lockfile pulls Electron; dsh web never needs its binary.
    const failure = await step(`install ${directory}`, ['pnpm', 'install', '--frozen-lockfile'], join(input.root, directory), {
      ...process.env,
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    })
    if (failure !== null) return { installed, dshx: false, plugins: [], failure }
    installed.push(directory)
  }
  if (input.plan.dshx) {
    const failure = await step('build dshx', ['pnpm', '--dir', DSHX_WORKSPACE, 'run', 'build'], input.root)
    if (failure !== null) return { installed, dshx: false, plugins: [], failure }
  }
  if (input.plan.plugins.length === 0) return { installed, dshx: input.plan.dshx, plugins: [], failure: null }

  const directories = new Map(readPluginPackages(input.root).map(pluginPackage => [pluginPackage.name, pluginPackage.directory] as const))
  const bundleFingerprints = (name: string) => {
    const dist = join(input.root, directories.get(name) ?? '', 'dist')
    return { host: fingerprint(join(dist, 'index.js')), client: fingerprint(join(dist, 'client.js')) }
  }
  const before = new Map(input.plan.plugins.map(plugin => [plugin.name, bundleFingerprints(plugin.name)] as const))
  const filters = input.plan.plugins.flatMap(plugin => ['--filter', plugin.name])
  const failure = await step('build plugins', ['pnpm', '--dir', PLUGINS_DIRECTORY, ...filters, 'run', 'build'], input.root)
  const changed = new Set(input.changedFiles)
  const plugins = input.plan.plugins.map(plugin => {
    const directory = directories.get(plugin.name) ?? ''
    const previous = before.get(plugin.name)
    const after = bundleFingerprints(plugin.name)
    const manifestChanged = changed.has(`${directory}/package.json`) || changed.has(`${directory}/cordis.patch.yml`)
    return { name: plugin.name, host: manifestChanged || previous?.host !== after.host, client: previous?.client !== after.client }
  })
  return { installed, dshx: input.plan.dshx, plugins, failure }
}

export class CheckoutRebuild {
  static readonly plan = planRebuild
  static readonly command = runCommand
  static readonly run = runRebuild
}
