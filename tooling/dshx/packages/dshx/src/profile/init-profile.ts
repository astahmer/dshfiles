import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import writeFileAtomic from 'write-file-atomic'
import { BundleSuppliers } from '../project/bundle-suppliers.js'
import { DSHFILES_ROOT, LocalBundleModel } from '../project/local-bundles.js'
import { ProfilePluginError, ProfilePlugins, RESTART_HOST, profileNameSchema, type ProfilePluginDependencies } from './add-plugin.js'

/**
 * The onboarding plugin owns the one definition of the packs. That plugin depends on dshx, so dshx reads the file from
 * this checkout (Node strips its types) instead of importing the package, which would close a dependency cycle.
 */
const PACKS_SOURCE = 'plugins/@dshfiles/onboarding/src/packs.ts'

const packSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  title: Schema.String,
  summary: Schema.String,
  core: Schema.Boolean,
  plugins: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
})
export type Pack = typeof packSchema.Type
const packsModuleSchema = Schema.Struct({ PACKS: Schema.Array(packSchema) })

/** A request that names something that does not exist: the CLI exits 2 for it. */
export class PackSelectionError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'PackSelectionError'
    this.hint = hint
  }
}

const loadPacks = async (): Promise<readonly Pack[]> => {
  const file = join(DSHFILES_ROOT, PACKS_SOURCE)
  if (!existsSync(file))
    throw new ProfilePluginError(
      `The pack definitions are missing: ${PACKS_SOURCE} is not in this checkout.`,
      'Run dshx from a dshfiles checkout that has the onboarding plugin.',
    )
  return Schema.decodeUnknownSync(packsModuleSchema)(await import(pathToFileURL(file).href)).PACKS
}

const initInputSchema = Schema.Struct({
  catalog: Schema.Array(packSchema),
  packs: Schema.Array(Schema.String),
  profile: profileNameSchema,
  dshHome: Schema.String.check(Schema.isMinLength(1)),
  extend: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  dryRun: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
})
type InitInput = Schema.Codec.Encoded<typeof initInputSchema>

interface InitFile {
  readonly path: string
  readonly change: string
}

export interface InitProfilePlan {
  readonly profile: string
  readonly profileRoot: string
  readonly packs: readonly { readonly id: string; readonly title: string }[]
  /** Every owned bundle the packs compose, suppliers included, in pack order. */
  readonly plugins: readonly string[]
  /** Owned bundles added because a composed plugin's client keeps them external. */
  readonly suppliers: readonly string[]
  /** Owned bundles the profile already held outside these packs; kept with --extend. */
  readonly kept: readonly string[]
  readonly created: boolean
  readonly linked: readonly string[]
  readonly upToDate: boolean
  readonly commands: readonly string[]
  readonly files: readonly InitFile[]
  readonly restart: string | null
  readonly dryRun: boolean
}

/** The packs a request selects, Core always first, in the order the definition lists them. */
const selectPacks = (input: { readonly catalog: readonly Pack[]; readonly requested: readonly string[] }): readonly Pack[] => {
  const unknown = input.requested.filter(id => !input.catalog.some(pack => pack.id === id))
  if (unknown.length > 0)
    throw new PackSelectionError(
      `Unknown pack${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
      `Pass --packs with ids from: ${input.catalog.map(pack => pack.id).join(', ')}.`,
    )
  return input.catalog.filter(pack => pack.core || input.requested.includes(pack.id))
}

const composedBundles = async (packs: readonly Pack[], dependencies: ProfilePluginDependencies) => {
  const checkout = await LocalBundleModel.listLocalBootBundles(dependencies.pluginsRoot === undefined ? {} : { pluginsRoot: dependencies.pluginsRoot })
  const named = [...new Set(packs.flatMap(pack => pack.plugins.map(plugin => `@dshfiles/${plugin}`)))]
  const missing = named.filter(packageName => !checkout.some(bundle => bundle.packageId === packageName))
  if (missing.length > 0)
    throw new ProfilePluginError(
      `The packs name owned plugins this checkout does not have: ${missing.join(', ')}.`,
      'Update the checkout, or fix the pack definition in plugins/@dshfiles/onboarding/src/packs.ts.',
    )
  const composed = BundleSuppliers.withSuppliers({
    bundles: named.flatMap(packageName => checkout.filter(bundle => bundle.packageId === packageName)),
    manifestPath: bundle => join(bundle.projectRoot, 'package.json'),
    supplier: packageId => checkout.find(bundle => bundle.packageId === packageId),
  }).map(bundle => bundle.packageId)
  return { composed, suppliers: composed.filter(packageName => !named.includes(packageName)) }
}

/** What `dsh plugin` writes when it creates a profile, with the `web` template's bundles: these plugins run in the Web UI. */
const newProfileFiles = (profileRoot: string) => ({
  'package.json': `${JSON.stringify(
    {
      name: `dsh-profile-${basename(profileRoot)}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    },
    null,
    2,
  )}\n`,
  'cordis.patch.yml': `# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; \`!!js\` expressions allowed).\n[]\n`,
  'pnpm-workspace.yaml': 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
})

const sample = (names: readonly string[]): string =>
  names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} and ${String(names.length - 4)} more`

/** Compose a profile from packs and link their plugins through profile-sync; never restarts DSH and never removes a plugin. */
const initProfile = async (input: InitInput, dependencies: ProfilePluginDependencies = {}): Promise<InitProfilePlan> => {
  const request = Schema.decodeUnknownSync(initInputSchema)(input)
  const packs = selectPacks({ catalog: request.catalog, requested: request.packs })
  const { composed, suppliers } = await composedBundles(packs, dependencies)
  const location = { profile: request.profile, dshHome: request.dshHome }
  const profileRoot = ProfilePlugins.profileRoot(location)
  const existing = await ProfilePlugins.readBundles(location)
  const owned = (existing?.bundles ?? []).filter(name => name.startsWith('@dshfiles/'))
  const kept = owned.filter(name => !composed.includes(name))
  const absent = composed.filter(name => !owned.includes(name))
  if (owned.length > 0 && (kept.length > 0 || absent.length > 0) && !request.extend)
    throw new ProfilePluginError(
      `Profile ${request.profile} already holds a different set of owned plugins: ${String(kept.length)} outside these packs${kept.length === 0 ? '' : ` (${sample(kept)})`}, ${String(absent.length)} of theirs missing.`,
      `Pass --extend to add the packs' plugins and keep the others (nothing is removed), or pass a new --profile name.`,
    )
  if (existing === undefined && existsSync(profileRoot))
    throw new ProfilePluginError(
      `Profile ${request.profile} has a directory at ${profileRoot} but no package.json.`,
      `Create it first (dsh --profile ${request.profile}), or pass --profile <name>.`,
    )

  const created = existing === undefined
  const files: InitFile[] = []
  if (created) {
    const seeded = newProfileFiles(profileRoot)
    for (const [file, content] of Object.entries(seeded)) {
      files.push({ path: join(profileRoot, file), change: 'new profile file' })
      if (request.dryRun) continue
      await mkdir(profileRoot, { recursive: true, mode: 0o700 })
      await writeFileAtomic(join(profileRoot, file), content, { mode: 0o600 })
    }
  }
  const base = {
    profile: request.profile,
    profileRoot,
    packs: packs.map(pack => ({ id: pack.id, title: pack.title })),
    plugins: composed,
    suppliers,
    kept,
    created,
    dryRun: request.dryRun,
  }
  if (created && request.dryRun)
    return {
      ...base,
      linked: composed,
      upToDate: false,
      commands: [ProfilePlugins.ownedSyncCommand({ ...location, packageNames: composed })],
      files: [...files, { path: join(profileRoot, 'node_modules'), change: 'pnpm install' }],
      restart: RESTART_HOST,
    }
  const linked = await ProfilePlugins.addOwned({ ...location, packageNames: composed, dryRun: request.dryRun }, dependencies)
  const changed = [...files, ...linked.files]
  return {
    ...base,
    linked: linked.linked,
    upToDate: changed.length === 0,
    commands: linked.commands,
    files: changed,
    restart: changed.length > 0 ? RESTART_HOST : null,
  }
}

/** `dshx init`: a DSH profile composed from the onboarding packs. */
export class ProfileInit {
  static readonly loadPacks = loadPacks
  static readonly apply = initProfile
}
