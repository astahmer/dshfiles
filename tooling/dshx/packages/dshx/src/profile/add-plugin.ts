import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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

export const addPluginInputSchema = z.object({
  packageSpec: z.string().min(1),
  profile: z.string().regex(/^[A-Za-z0-9._-]+$/u, 'Profile names are plain directory names.'),
  dshHome: z.string().min(1),
  options: z.array(z.string().regex(optionPattern, 'Options take the form key=value.')).default([]),
  dryRun: z.boolean().default(false),
  cwd: z.string().default(process.cwd()),
})
export type AddPluginInput = z.input<typeof addPluginInputSchema>

export interface AddPluginDependencies {
  readonly pluginsRoot?: string
  readonly runDsh?: DshCommandRunner
}

export interface AddPluginFile {
  readonly path: string
  readonly change: string
}

export interface AddPluginPlan {
  readonly packageName: string
  readonly source: 'owned' | 'registry'
  readonly profile: string
  readonly profileRoot: string
  readonly rowId: string
  readonly commands: readonly string[]
  readonly files: readonly AddPluginFile[]
  readonly config: JsonObject | null
  readonly clientInject: readonly string[]
  readonly warnings: readonly string[]
  readonly restart: string | null
  readonly dryRun: boolean
}

export class AddPluginError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'AddPluginError'
    this.hint = hint
  }
}

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

const profileManifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).default({}),
  dsh: z.looseObject({ profile: z.looseObject({ bundles: z.array(z.string()).default([]) }).default({ bundles: [] }) }).default({ profile: { bundles: [] } }),
})

const bundleManifestSchema = z.looseObject({
  name: z.string().min(1),
  main: z.string().optional(),
  dsh: z
    .looseObject({
      bundle: z.looseObject({ patch: z.string().optional() }).optional(),
      client: z.looseObject({ inject: z.array(z.string()).default([]) }).optional(),
    })
    .optional(),
})

const bundlePatchSchema = z.array(
  z.looseObject({
    insert: z.array(z.looseObject({ id: z.string().optional(), name: z.string().optional(), config: jsonObjectSchema.optional() })).optional(),
  }),
)
const callableSchema = z.custom<(value: JsonObject) => void>(value => typeof value === 'function')
const hostModuleSchema = z.looseObject({ Config: z.unknown() })

/** Loader row ids share one namespace per profile, so the scope stays in the id. */
const scopeKeptSlug = (packageName: string): string => packageName.replace(/^@/u, '').replace(/\//gu, '-')

const readBundleManifest = async (projectRoot: string) => decodeJson(bundleManifestSchema, await readFile(join(projectRoot, 'package.json'), 'utf8'))

const insertedRow = async (projectRoot: string, packageName: string) => {
  const manifest = await readBundleManifest(projectRoot)
  const patchPath = join(projectRoot, manifest.dsh?.bundle?.patch ?? 'cordis.patch.yml')
  if (!existsSync(patchPath)) return { id: scopeKeptSlug(packageName), config: {}, clientInject: manifest.dsh?.client?.inject ?? [] }
  const patch = bundlePatchSchema.safeParse(parse(await readFile(patchPath, 'utf8'), { customTags: [jsTag] }))
  const row = patch.success ? patch.data.flatMap(entry => entry.insert ?? []).find(candidate => candidate.name === packageName) : undefined
  return { id: row?.id ?? scopeKeptSlug(packageName), config: row?.config ?? {}, clientInject: manifest.dsh?.client?.inject ?? [] }
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

const findOverride = (document: Document, rowId: string) => {
  const root = document.contents
  if (!isSeq(root)) return undefined
  return root.items.find(item => isMap(item) && item.get('id') === rowId && !item.has('insert'))
}

const overrideConfigSchema = z.looseObject({ config: jsonObjectSchema.default({}) })

/** A patch entry replaces the row's whole `config`, so a new override starts from the bundle's own row config. */
const mergedPatch = (source: string, row: { id: string; name: string; baseConfig: JsonObject }, options: JsonObject) => {
  const document = source.trim() === '' ? new Document([]) : parseDocument(source, { customTags: [jsTag] })
  if (document.errors.length > 0)
    throw new AddPluginError(`The profile cordis.patch.yml is not valid YAML: ${document.errors[0]?.message ?? ''}`, 'Fix the YAML syntax first.')
  if (!isSeq(document.contents)) throw new AddPluginError('The profile cordis.patch.yml must be a top-level YAML array.', 'Prefix each patch entry with "-".')
  const existing = findOverride(document, row.id)
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
  readonly source: 'owned' | 'registry'
  readonly projectRoot: string | undefined
}

const resolvePackage = async (packageSpec: string, cwd: string, pluginsRoot: string | undefined): Promise<ResolvedPackage> => {
  const owned = await LocalBundleModel.listLocalBootBundles(pluginsRoot === undefined ? {} : { pluginsRoot })
  const looksLikePath = packageSpec.startsWith('.') || isAbsolute(packageSpec)
  if (looksLikePath) {
    const directory = resolve(cwd, packageSpec)
    const bundle = owned.find(candidate => resolve(candidate.projectRoot) === directory)
    if (bundle === undefined)
      throw new AddPluginError(`${directory} is not an owned plugin bundle.`, 'Pass a directory under plugins/@dshfiles, or a registry package name.')
    return { packageName: bundle.packageId, source: 'owned', projectRoot: bundle.projectRoot }
  }
  const bundle = owned.find(candidate => candidate.packageId === packageSpec)
  if (bundle !== undefined) return { packageName: bundle.packageId, source: 'owned', projectRoot: bundle.projectRoot }
  if (packageSpec.startsWith('@dshfiles/'))
    throw new AddPluginError(`Owned plugin bundle ${packageSpec} was not found under plugins/@dshfiles.`, 'Check the name with "ls plugins/@dshfiles".')
  if (!packageNamePattern.test(packageSpec))
    throw new AddPluginError(`${packageSpec} is not a package name or plugin directory.`, 'Pass e.g. @scope/name or ./plugins/@dshfiles/name.')
  return { packageName: packageSpec, source: 'registry', projectRoot: undefined }
}

const commandLine = (parts: readonly string[]): string =>
  parts.map(part => (/^[\w@./:=-]+$/u.test(part) ? part : `'${part.replace(/'/gu, `'\\''`)}'`)).join(' ')

/** Install one plugin into a DSH profile and merge its row config; never restarts DSH. */
export const addPluginToProfile = async (input: AddPluginInput, dependencies: AddPluginDependencies = {}): Promise<AddPluginPlan> => {
  const request = addPluginInputSchema.parse(input)
  const profileRoot = join(resolve(request.dshHome), 'profiles', request.profile)
  const manifestPath = join(profileRoot, 'package.json')
  const patchPath = join(profileRoot, 'cordis.patch.yml')
  if (!existsSync(manifestPath))
    throw new AddPluginError(
      `Profile ${request.profile} does not exist at ${profileRoot}.`,
      `Create it first (dsh --profile ${request.profile}), or pass --profile <name>.`,
    )

  const resolved = await resolvePackage(request.packageSpec, request.cwd, dependencies.pluginsRoot)
  const options = parseOptions(request.options)
  const warnings: string[] = []
  const commands: string[] = []
  const files: AddPluginFile[] = []
  const manifest = decodeJson(profileManifestSchema, await readFile(manifestPath, 'utf8'))
  const env = { ...process.env, DSH_HOME: resolve(request.dshHome) }

  const install = async (): Promise<void> => {
    if (resolved.source === 'owned' && resolved.projectRoot !== undefined) {
      const linked =
        manifest.dependencies[resolved.packageName] === `link:${resolved.projectRoot}` && manifest.dsh.profile.bundles.includes(resolved.packageName)
      if (linked) return
      const sync = [
        join(DSHFILES_ROOT, 'scripts/profile-sync.ts'),
        '--profile',
        request.profile,
        '--home',
        resolve(request.dshHome),
        '--bundle',
        resolved.packageName,
      ]
      commands.push(commandLine([process.execPath, ...sync]))
      files.push({ path: manifestPath, change: 'link: dependency and bundle entry' }, { path: join(profileRoot, 'node_modules'), change: 'pnpm install' })
      if (request.dryRun) return
      const result = await execa(process.execPath, sync, { cwd: DSHFILES_ROOT, env, reject: false })
      if (result.exitCode !== 0)
        throw new AddPluginError(
          `profile-sync failed for ${resolved.packageName}: ${(result.stderr || result.stdout).trim()}`,
          'Run the printed command by hand to see the full output.',
        )
      return
    }
    if (Object.hasOwn(manifest.dependencies, resolved.packageName) && manifest.dsh.profile.bundles.includes(resolved.packageName)) return
    const args = ['plugin', '--profile', request.profile, 'add', resolved.packageName]
    commands.push(commandLine(['dsh', ...args]))
    files.push({ path: manifestPath, change: 'registry dependency and bundle entry' }, { path: join(profileRoot, 'node_modules'), change: 'dsh plugin add' })
    if (request.dryRun) return
    const result = await (dependencies.runDsh ?? runProjectDsh)(args, { cwd: profileRoot, env, timeoutMs: 300_000 })
    if (result.exitCode !== 0)
      throw new AddPluginError(
        `dsh plugin add ${resolved.packageName} failed: ${(result.stderr || result.stdout).trim()}`,
        'Check the package name on the registry.',
      )
  }

  const planConfig = async () => {
    const installedRoot = resolved.projectRoot ?? join(profileRoot, 'node_modules', resolved.packageName)
    const bundleKnown = existsSync(join(installedRoot, 'package.json'))
    const row = bundleKnown ? await insertedRow(installedRoot, resolved.packageName) : { id: scopeKeptSlug(resolved.packageName), config: {}, clientInject: [] }
    if (!bundleKnown) warnings.push(`${resolved.packageName} is not installed yet, so its row id is assumed to be ${row.id}.`)
    if (Object.keys(options).length === 0) return { row, config: null, write: async () => {} }
    const currentPatch = existsSync(patchPath) ? await readFile(patchPath, 'utf8') : ''
    const merged = mergedPatch(currentPatch, { id: row.id, name: resolved.packageName, baseConfig: row.config }, options)
    const validator = bundleKnown ? await loadConfigValidator(installedRoot) : 'it is not installed yet'
    if (typeof validator === 'string') warnings.push(`Options were not validated: ${validator}.`)
    else {
      try {
        await validator(merged.config)
      } catch (error) {
        throw new AddPluginError(
          `Options do not match the ${resolved.packageName} config schema: ${error instanceof Error ? error.message : String(error)}`,
          'Check the option names and value types in the plugin README or settings.',
        )
      }
    }
    const write = async (): Promise<void> => {
      if (merged.text === currentPatch) return
      files.push({ path: patchPath, change: `row ${row.id} config` })
      if (!request.dryRun) await writeFileAtomic(patchPath, merged.text)
    }
    return { row, config: merged.config, write }
  }

  // Owned options are validated before anything is installed; a registry package must be installed before its schema is readable.
  const configPlan = resolved.source === 'owned' ? await planConfig() : undefined
  await install()
  const { row, config, write } = configPlan ?? (await planConfig())
  await write()

  return {
    packageName: resolved.packageName,
    source: resolved.source,
    profile: request.profile,
    profileRoot,
    rowId: row.id,
    commands,
    files,
    config,
    clientInject: row.clientInject,
    warnings,
    restart: files.length > 0 ? RESTART_HOST : null,
    dryRun: request.dryRun,
  }
}
