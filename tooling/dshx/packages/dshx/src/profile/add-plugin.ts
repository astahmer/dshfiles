import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'
import writeFileAtomic from 'write-file-atomic'
import { Document, isMap, isSeq, parse, parseDocument } from 'yaml'
import { z } from 'zod'
import { decodeJson, jsonObjectSchema, jsonValueSchema, type JsonObject } from '../json.js'
import { HostRuntimeModel } from '../host/runtime.js'
import { DSHFILES_ROOT, LocalBundleModel } from '../project/local-bundles.js'
import { runProjectDsh } from './command.js'
import type { DshCommandRunner } from './types.js'

export const RESTART_HOST = 'Restart the DSH host process'

const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (expression: string) => expression }
const optionPattern = /^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$/su

const profileTargetSchema = z.object({
  packageSpec: z.string().min(1),
  profile: z.string().regex(/^[A-Za-z0-9._-]+$/u, 'Profile names are plain directory names.'),
  dshHome: z.string().min(1),
  dryRun: z.boolean().default(false),
  cwd: z.string().default(process.cwd()),
})
type ProfileTarget = z.output<typeof profileTargetSchema>

const addPluginInputSchema = profileTargetSchema.extend({
  options: z.array(z.string().regex(optionPattern, 'Options take the form key=value.')).default([]),
})
type AddPluginInput = z.input<typeof addPluginInputSchema>

const updatePluginInputSchema = profileTargetSchema.extend({ latest: z.boolean().default(false) })
type UpdatePluginInput = z.input<typeof updatePluginInputSchema>
type RemovePluginInput = z.input<typeof profileTargetSchema>

export interface ProfilePluginDependencies {
  readonly pluginsRoot?: string
  readonly runDsh?: DshCommandRunner
  /** Directory holding checked-in profile seeds; defaults to this repository's `profiles/`. */
  readonly seedsRoot?: string
}

interface ProfilePluginFile {
  readonly path: string
  readonly change: string
}

/** Which halves one package ships: a Host entry, a Client entry, and contract modules other plugins import. */
interface ProfilePluginParts {
  readonly host: boolean
  readonly client: boolean
  readonly modules: readonly string[]
}

export interface ProfilePluginPlan {
  readonly action: 'add' | 'update' | 'remove'
  readonly packageName: string
  readonly source: 'owned' | 'local' | 'registry'
  readonly requested: string | null
  readonly profile: string
  readonly profileRoot: string
  readonly rowId: string
  readonly commands: readonly string[]
  readonly files: readonly ProfilePluginFile[]
  readonly config: JsonObject | null
  readonly clientInject: readonly string[]
  readonly parts: ProfilePluginParts | null
  readonly versions: { readonly before: string | null; readonly after: string | null }
  readonly warnings: readonly string[]
  readonly restart: string | null
  readonly dryRun: boolean
}

export class ProfilePluginError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'ProfilePluginError'
    this.hint = hint
  }
}

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const versionedSpecPattern = /^((?:@[^/@]+\/)?[^@]+)@(.+)$/u

const profileManifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).default({}),
  dsh: z.looseObject({ profile: z.looseObject({ bundles: z.array(z.string()).default([]) }).default({ bundles: [] }) }).default({ profile: { bundles: [] } }),
})

const bundleManifestSchema = z.looseObject({
  name: z.string().min(1),
  version: z.string().optional(),
  main: z.string().optional(),
  exports: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  dsh: z
    .looseObject({
      bundle: z.looseObject({ patch: z.string().optional() }).optional(),
      client: z.looseObject({ inject: z.array(z.string()).default([]) }).optional(),
    })
    .optional(),
})
type BundleManifest = z.output<typeof bundleManifestSchema>

const bundlePatchSchema = z.array(
  z.looseObject({
    insert: z.array(z.looseObject({ id: z.string().optional(), name: z.string().optional(), config: jsonObjectSchema.optional() })).optional(),
  }),
)
const callableSchema = z.custom<(value: JsonObject) => void>(value => typeof value === 'function')
const hostModuleSchema = z.looseObject({ Config: z.unknown() })
const seedManifestSchema = z.looseObject({ dependencies: z.record(z.string(), z.string()).default({}) })

/** Loader row ids share one namespace per profile, so the scope stays in the id. */
const scopeKeptSlug = (packageName: string): string => packageName.replace(/^@/u, '').replace(/\//gu, '-')

const readBundleManifest = async (projectRoot: string) => decodeJson(bundleManifestSchema, await readFile(join(projectRoot, 'package.json'), 'utf8'))

/** Export subpaths other than the Host entry, the Client entry and package metadata are contract modules. */
const shippedParts = (manifest: BundleManifest): ProfilePluginParts => {
  const exportMap = typeof manifest.exports === 'object' ? manifest.exports : {}
  const metadataPaths = new Set(['.', './client', './package.json', './cordis.patch.yml'])
  return {
    host: manifest.main !== undefined || typeof manifest.exports === 'string' || Object.hasOwn(exportMap, '.'),
    client: manifest.dsh?.client !== undefined || Object.hasOwn(exportMap, './client'),
    modules: Object.keys(exportMap).filter(path => !metadataPaths.has(path)),
  }
}

const insertedRow = async (projectRoot: string, packageName: string) => {
  const manifest = await readBundleManifest(projectRoot)
  const patchPath = join(projectRoot, manifest.dsh?.bundle?.patch ?? 'cordis.patch.yml')
  const shipped = { clientInject: manifest.dsh?.client?.inject ?? [], parts: shippedParts(manifest), version: manifest.version ?? null }
  if (!existsSync(patchPath)) return { id: scopeKeptSlug(packageName), config: {}, ...shipped }
  const patch = bundlePatchSchema.safeParse(parse(await readFile(patchPath, 'utf8'), { customTags: [jsTag] }))
  const row = patch.success ? patch.data.flatMap(entry => entry.insert ?? []).find(candidate => candidate.name === packageName) : undefined
  return { id: row?.id ?? scopeKeptSlug(packageName), config: row?.config ?? {}, ...shipped }
}

/** A dshx Host bundle exports a Standard Schema `Config`; a native Cordis plugin exports a callable Schemastery schema. */
const loadConfigValidator = async (projectRoot: string): Promise<((value: JsonObject) => Promise<void>) | string> => {
  const manifest = await readBundleManifest(projectRoot)
  const entry = join(projectRoot, manifest.main ?? 'dist/index.js')
  if (!existsSync(entry)) return `${relative(process.cwd(), entry) || entry} is not built`
  try {
    const exported = hostModuleSchema.parse(await import(pathToFileURL(entry).href)).Config
    if (HostRuntimeModel.isStandardSchema(exported))
      return async value => {
        const result = await exported['~standard'].validate(value)
        if (result.issues !== undefined)
          throw new Error(
            result.issues
              .map(
                issue =>
                  `${(issue.path ?? []).map(segment => String(typeof segment === 'object' ? segment.key : segment)).join('.') || '(root)'}: ${issue.message}`,
              )
              .join('; '),
          )
      }
    const callable = callableSchema.safeParse(exported)
    if (callable.success)
      return async value => {
        callable.data(value)
      }
    return 'its Host entry exports no Config schema'
  } catch (error) {
    return `its Host entry could not be loaded (${error instanceof Error ? error.message : String(error)})`
  }
}

const parseOptions = (options: readonly string[]): JsonObject =>
  Object.fromEntries(
    options.map(option => {
      const [, key = '', raw = ''] = optionPattern.exec(option) ?? []
      return [key, raw === '' ? '' : jsonValueSchema.parse(parse(raw))]
    }),
  )

const isOverride =
  (rowId: string) =>
  (item: unknown): boolean =>
    isMap(item) && item.get('id') === rowId && !item.has('insert')

const parsePatch = (source: string): Document => {
  const document = source.trim() === '' ? new Document([]) : parseDocument(source, { customTags: [jsTag] })
  if (document.errors.length > 0)
    throw new ProfilePluginError(`The profile cordis.patch.yml is not valid YAML: ${document.errors[0]?.message ?? ''}`, 'Fix the YAML syntax first.')
  if (!isSeq(document.contents))
    throw new ProfilePluginError('The profile cordis.patch.yml must be a top-level YAML array.', 'Prefix each patch entry with "-".')
  return document
}

const overrideConfigSchema = z.looseObject({ config: jsonObjectSchema.default({}) })

/** A patch entry replaces the row's whole `config`, so a new override starts from the bundle's own row config. */
const mergedPatch = (source: string, row: { id: string; name: string; baseConfig: JsonObject }, options: JsonObject) => {
  const document = parsePatch(source)
  const existing = isSeq(document.contents) ? document.contents.items.find(isOverride(row.id)) : undefined
  if (isMap(existing) && existing.has('config')) {
    for (const [key, value] of Object.entries(options)) existing.setIn(['config', key], value)
  } else if (isMap(existing)) {
    existing.set('config', document.createNode({ ...row.baseConfig, ...options }))
  } else {
    document.add(document.createNode({ id: row.id, name: row.name, config: { ...row.baseConfig, ...options } }))
  }
  const config = isMap(existing) ? overrideConfigSchema.parse(existing.toJSON()).config : { ...row.baseConfig, ...options }
  return { text: document.toString({ singleQuote: true }), config }
}

interface ResolvedPackage {
  readonly packageName: string
  readonly source: 'owned' | 'local' | 'registry'
  readonly projectRoot: string | undefined
  readonly version: string | undefined
}

const splitVersion = (packageSpec: string): { readonly name: string; readonly version: string | undefined } => {
  const match = versionedSpecPattern.exec(packageSpec)
  if (match?.[1] === undefined || match[2] === undefined) return { name: packageSpec, version: undefined }
  return { name: match[1], version: match[2] }
}

const resolvePackage = async (packageSpec: string, cwd: string, pluginsRoot: string | undefined): Promise<ResolvedPackage> => {
  const owned = await LocalBundleModel.listLocalBootBundles(pluginsRoot === undefined ? {} : { pluginsRoot })
  const pathSpec = packageSpec.replace(/^link:/u, '')
  if (pathSpec.startsWith('.') || isAbsolute(pathSpec)) {
    const directory = resolve(cwd, pathSpec)
    const bundle = owned.find(candidate => resolve(candidate.projectRoot) === directory)
    if (bundle !== undefined) return { packageName: bundle.packageId, source: 'owned', projectRoot: bundle.projectRoot, version: undefined }
    if (!existsSync(join(directory, 'package.json')))
      throw new ProfilePluginError(`${directory} has no package.json.`, 'Pass the directory of a built DSH plugin package.')
    const manifest = await readBundleManifest(directory)
    if (manifest.dsh?.bundle === undefined)
      throw new ProfilePluginError(
        `${manifest.name} at ${directory} declares no dsh.bundle, so DSH would install it as a plain dependency.`,
        'Add "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } to its package.json (dshx create does this).',
      )
    return { packageName: manifest.name, source: 'local', projectRoot: directory, version: undefined }
  }
  const { name, version } = splitVersion(packageSpec)
  const bundle = owned.find(candidate => candidate.packageId === name)
  if (bundle !== undefined && version !== undefined)
    throw new ProfilePluginError(`${name} is an owned bundle; it follows this checkout, so it takes no version.`, `Run "dshx add ${name}".`)
  if (bundle !== undefined) return { packageName: bundle.packageId, source: 'owned', projectRoot: bundle.projectRoot, version: undefined }
  if (name.startsWith('@dshfiles/'))
    throw new ProfilePluginError(`Owned plugin bundle ${name} was not found under plugins/@dshfiles.`, 'Check the name with "ls plugins/@dshfiles".')
  if (!packageNamePattern.test(name))
    throw new ProfilePluginError(`${packageSpec} is not a package name or plugin directory.`, 'Pass e.g. @scope/name, @scope/name@1.2.0 or ./path/to/plugin.')
  return { packageName: name, source: 'registry', projectRoot: undefined, version }
}

const commandLine = (parts: readonly string[]): string =>
  parts.map(part => (/^[\w@./:=^~-]+$/u.test(part) ? part : `'${part.replace(/'/gu, `'\\''`)}'`)).join(' ')

const installedVersion = async (root: string): Promise<string | null> =>
  existsSync(join(root, 'package.json')) ? ((await readBundleManifest(root)).version ?? null) : null

const openProfile = async (target: ProfileTarget) => {
  const profileRoot = join(resolve(target.dshHome), 'profiles', target.profile)
  const manifestPath = join(profileRoot, 'package.json')
  if (!existsSync(manifestPath))
    throw new ProfilePluginError(
      `Profile ${target.profile} does not exist at ${profileRoot}.`,
      `Create it first (dsh --profile ${target.profile}), or pass --profile <name>.`,
    )
  return {
    profileRoot,
    manifestPath,
    patchPath: join(profileRoot, 'cordis.patch.yml'),
    manifest: decodeJson(profileManifestSchema, await readFile(manifestPath, 'utf8')),
    env: { ...process.env, DSH_HOME: resolve(target.dshHome) },
  }
}

type OpenProfile = Awaited<ReturnType<typeof openProfile>>

interface StepLog {
  readonly commands: string[]
  readonly files: ProfilePluginFile[]
}

/** The two ways a profile changes: `dsh plugin <pnpm args>` and profile-sync for owned bundles. Both are named in the plan, even in a dry run. */
const profileSteps = (target: ProfileTarget, profile: OpenProfile, dependencies: ProfilePluginDependencies, log: StepLog) => ({
  dsh: async (args: readonly string[], change: string, failureHint: string): Promise<void> => {
    const full = ['plugin', '--profile', target.profile, ...args]
    log.commands.push(commandLine(['dsh', ...full]))
    log.files.push({ path: profile.manifestPath, change }, { path: join(profile.profileRoot, 'node_modules'), change: `dsh plugin ${args[0] ?? ''}` })
    if (target.dryRun) return
    const result = await (dependencies.runDsh ?? runProjectDsh)(full, { cwd: target.cwd, env: profile.env, timeoutMs: 300_000 })
    if (result.exitCode !== 0) throw new ProfilePluginError(`dsh ${full.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`, failureHint)
  },
  syncOwned: async (packageName: string): Promise<void> => {
    const sync = [join(DSHFILES_ROOT, 'scripts/profile-sync.ts'), '--profile', target.profile, '--home', resolve(target.dshHome), '--bundle', packageName]
    log.commands.push(commandLine([process.execPath, ...sync]))
    log.files.push(
      { path: profile.manifestPath, change: 'link: dependency and bundle entry' },
      { path: join(profile.profileRoot, 'node_modules'), change: 'pnpm install' },
    )
    if (target.dryRun) return
    const result = await execa(process.execPath, sync, { cwd: DSHFILES_ROOT, env: profile.env, reject: false })
    if (result.exitCode !== 0)
      throw new ProfilePluginError(
        `profile-sync failed for ${packageName}: ${(result.stderr || result.stdout).trim()}`,
        'Run the printed command by hand to see the full output.',
      )
  },
})

/** Install one plugin into a DSH profile and merge its row config; never restarts DSH. */
const addPluginToProfile = async (input: AddPluginInput, dependencies: ProfilePluginDependencies = {}): Promise<ProfilePluginPlan> => {
  const request = addPluginInputSchema.parse(input)
  const profile = await openProfile(request)
  const resolved = await resolvePackage(request.packageSpec, request.cwd, dependencies.pluginsRoot)
  const options = parseOptions(request.options)
  const warnings: string[] = []
  const log: StepLog = { commands: [], files: [] }
  const steps = profileSteps(request, profile, dependencies, log)
  const { manifest } = profile
  const installedRoot = resolved.projectRoot ?? join(profile.profileRoot, 'node_modules', resolved.packageName)
  const before = await installedVersion(join(profile.profileRoot, 'node_modules', resolved.packageName))
  const listed = Object.hasOwn(manifest.dependencies, resolved.packageName) && manifest.dsh.profile.bundles.includes(resolved.packageName)
  const linkedHere = listed && manifest.dependencies[resolved.packageName] === `link:${resolved.projectRoot ?? ''}`

  const install = async (): Promise<void> => {
    if (resolved.source === 'owned') {
      if (!linkedHere) await steps.syncOwned(resolved.packageName)
      return
    }
    if (resolved.source === 'local') {
      if (!linkedHere)
        await steps.dsh(
          ['add', `link:${resolved.projectRoot ?? ''}`],
          'link: dependency and bundle entry',
          'Check that the directory is a built DSH plugin package.',
        )
      return
    }
    const range = resolved.version === undefined ? null : semver.validRange(resolved.version)
    const satisfied = resolved.version === undefined || (range !== null && before !== null && semver.satisfies(before, range))
    if (listed && satisfied) return
    const spec = resolved.version === undefined ? resolved.packageName : `${resolved.packageName}@${resolved.version}`
    await steps.dsh(['add', spec], 'registry dependency and bundle entry', 'Check the package name and version on the registry.')
  }

  const planConfig = async () => {
    const bundleKnown = existsSync(join(installedRoot, 'package.json'))
    const row = bundleKnown
      ? await insertedRow(installedRoot, resolved.packageName)
      : { id: scopeKeptSlug(resolved.packageName), config: {}, clientInject: [], parts: null, version: null }
    if (!bundleKnown) warnings.push(`${resolved.packageName} is not installed yet, so its row id is assumed to be ${row.id}.`)
    if (Object.keys(options).length === 0) return { row, config: null, write: async () => {} }
    const currentPatch = existsSync(profile.patchPath) ? await readFile(profile.patchPath, 'utf8') : ''
    const merged = mergedPatch(currentPatch, { id: row.id, name: resolved.packageName, baseConfig: row.config }, options)
    const validator = bundleKnown ? await loadConfigValidator(installedRoot) : 'it is not installed yet'
    if (typeof validator === 'string') warnings.push(`Options were not validated: ${validator}.`)
    else {
      try {
        await validator(merged.config)
      } catch (error) {
        throw new ProfilePluginError(
          `Options do not match the ${resolved.packageName} config schema: ${error instanceof Error ? error.message : String(error)}`,
          'Check the option names and value types in the plugin README or settings.',
        )
      }
    }
    const write = async (): Promise<void> => {
      if (merged.text === currentPatch) return
      log.files.push({ path: profile.patchPath, change: `row ${row.id} config` })
      if (!request.dryRun) await writeFileAtomic(profile.patchPath, merged.text)
    }
    return { row, config: merged.config, write }
  }

  // A local package's options are validated before anything is installed; a registry package must be installed before its schema is readable.
  const configPlan = resolved.source === 'registry' ? undefined : await planConfig()
  await install()
  const { row, config, write } = configPlan ?? (await planConfig())
  await write()

  return {
    action: 'add',
    packageName: resolved.packageName,
    source: resolved.source,
    requested: resolved.version ?? null,
    profile: request.profile,
    profileRoot: profile.profileRoot,
    rowId: row.id,
    commands: log.commands,
    files: log.files,
    config,
    clientInject: row.clientInject,
    parts: row.parts,
    versions: { before, after: request.dryRun ? before : await installedVersion(installedRoot) },
    warnings,
    restart: log.files.length > 0 ? RESTART_HOST : null,
    dryRun: request.dryRun,
  }
}

/** Where an installed plugin comes from, read back from the profile manifest rather than from the spec. */
const installedPackage = (profile: OpenProfile, packageSpec: string) => {
  const { name, version } = splitVersion(packageSpec)
  const specifier = profile.manifest.dependencies[name]
  const linked = specifier?.startsWith('link:') === true ? specifier.slice('link:'.length) : undefined
  const source: ProfilePluginPlan['source'] = linked === undefined ? 'registry' : name.startsWith('@dshfiles/') ? 'owned' : 'local'
  return {
    name,
    version,
    source,
    listed: specifier !== undefined || profile.manifest.dsh.profile.bundles.includes(name),
    root: linked ?? join(profile.profileRoot, 'node_modules', name),
  }
}

/** Move a registry plugin within its range, to the latest or to a named version, or relink an owned bundle; never restarts DSH. */
const updatePluginInProfile = async (input: UpdatePluginInput, dependencies: ProfilePluginDependencies = {}): Promise<ProfilePluginPlan> => {
  const request = updatePluginInputSchema.parse(input)
  const profile = await openProfile(request)
  const target = installedPackage(profile, request.packageSpec)
  if (!target.listed)
    throw new ProfilePluginError(`${target.name} is not installed in profile ${request.profile}.`, `Install it with "dshx add ${request.packageSpec}".`)
  if (target.source !== 'registry' && (target.version !== undefined || request.latest))
    throw new ProfilePluginError(
      `${target.name} is linked from ${target.root}; a linked plugin has no version to move to.`,
      `Run "dshx update ${target.name}".`,
    )
  const warnings: string[] = []
  const log: StepLog = { commands: [], files: [] }
  const steps = profileSteps(request, profile, dependencies, log)
  const before = await installedVersion(target.root)
  const manifestBefore = await readFile(profile.manifestPath, 'utf8')

  const checkout = await LocalBundleModel.listLocalBootBundles(dependencies.pluginsRoot === undefined ? {} : { pluginsRoot: dependencies.pluginsRoot })
  const ownedHere = checkout.find(bundle => bundle.packageId === target.name)
  if (target.source === 'owned' && resolve(ownedHere?.projectRoot ?? '') !== resolve(target.root)) await steps.syncOwned(target.name)
  if (target.source === 'local') warnings.push(`${target.name} is linked from ${target.root}; DSH loads what is built there, so rebuild it in place.`)
  if (target.source === 'registry' && target.version !== undefined)
    await steps.dsh(['add', `${target.name}@${target.version}`], 'registry dependency version', 'Check the version exists on the registry.')
  if (target.source === 'registry' && target.version === undefined)
    await steps.dsh(
      ['update', ...(request.latest ? ['--latest'] : []), target.name],
      request.latest ? 'registry dependency moved to its latest version' : 'registry dependency within its range',
      'Re-run with --dry-run and run the printed command by hand.',
    )

  const after = request.dryRun ? before : await installedVersion(target.root)
  const changed = request.dryRun ? log.commands.length > 0 : after !== before || (await readFile(profile.manifestPath, 'utf8')) !== manifestBefore
  const row = existsSync(join(target.root, 'package.json')) ? await insertedRow(target.root, target.name) : undefined
  return {
    action: 'update',
    packageName: target.name,
    source: target.source,
    requested: target.version ?? (request.latest ? 'latest' : null),
    profile: request.profile,
    profileRoot: profile.profileRoot,
    rowId: row?.id ?? scopeKeptSlug(target.name),
    commands: log.commands,
    files: changed ? log.files : [],
    config: null,
    clientInject: row?.clientInject ?? [],
    parts: row?.parts ?? null,
    versions: { before, after },
    warnings,
    restart: changed ? RESTART_HOST : null,
    dryRun: request.dryRun,
  }
}

/** Uninstall one plugin and drop its row override from the profile patch; never restarts DSH. */
const removePluginFromProfile = async (input: RemovePluginInput, dependencies: ProfilePluginDependencies = {}): Promise<ProfilePluginPlan> => {
  const request = profileTargetSchema.parse(input)
  const profile = await openProfile(request)
  const target = installedPackage(profile, request.packageSpec)
  if (target.version !== undefined) throw new ProfilePluginError('dshx remove takes a package name without a version.', `Run "dshx remove ${target.name}".`)
  const warnings: string[] = []
  const log: StepLog = { commands: [], files: [] }
  const steps = profileSteps(request, profile, dependencies, log)
  // pnpm can leave a removed link behind in node_modules, so an unlisted package reads nothing from there.
  const row = target.listed && existsSync(join(target.root, 'package.json')) ? await insertedRow(target.root, target.name) : undefined
  const rowId = row?.id ?? scopeKeptSlug(target.name)
  const before = target.listed ? await installedVersion(target.root) : null

  if (target.listed)
    await steps.dsh(['remove', target.name], 'dependency and bundle entry removed', 'Re-run with --dry-run and run the printed command by hand.')

  // A leftover override would patch a row no bundle inserts any more.
  const currentPatch = existsSync(profile.patchPath) ? await readFile(profile.patchPath, 'utf8') : ''
  const document = parsePatch(currentPatch)
  if (isSeq(document.contents) && document.contents.items.some(isOverride(rowId))) {
    document.contents.items = document.contents.items.filter(item => !isOverride(rowId)(item))
    log.files.push({ path: profile.patchPath, change: `row ${rowId} override removed` })
    if (!request.dryRun) await writeFileAtomic(profile.patchPath, document.toString({ singleQuote: true }))
  }

  const seedPath = join(dependencies.seedsRoot ?? join(DSHFILES_ROOT, 'profiles'), request.profile, 'package.json')
  if (existsSync(seedPath) && Object.hasOwn(decodeJson(seedManifestSchema, await readFile(seedPath, 'utf8')).dependencies, target.name))
    warnings.push(`The checked-in ${request.profile} seed lists ${target.name}, so the next profile-sync adds it back; drop it from ${seedPath} too.`)

  return {
    action: 'remove',
    packageName: target.name,
    source: target.source,
    requested: null,
    profile: request.profile,
    profileRoot: profile.profileRoot,
    rowId,
    commands: log.commands,
    files: log.files,
    config: null,
    clientInject: [],
    parts: row?.parts ?? null,
    versions: { before, after: null },
    warnings,
    restart: log.files.length > 0 ? RESTART_HOST : null,
    dryRun: request.dryRun,
  }
}

/** One plugin's lifecycle in one DSH profile: install, move to another version, uninstall. */
export class ProfilePlugins {
  static readonly add = addPluginToProfile
  static readonly update = updatePluginInProfile
  static readonly remove = removePluginFromProfile
}
