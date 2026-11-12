import * as Schema from 'effect/Schema'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { decodeJson } from '../json.js'
import { ProfilePluginError, profileNameSchema, type ProfilePluginDependencies } from '../profile/add-plugin.js'
import { PackSelectionError, ProfileInit, type InitProfilePlan, type Pack } from '../profile/init-profile.js'
import { resolveDshExecutable } from '../project/dsh-executable.js'
import { SetupChecks, type ExistingProfile, type SetupCheck } from './setup-checks.js'

/** A starting point on the Preset screen: an editable list of packs, Core always included. */
export interface SetupPreset {
  readonly id: string
  readonly title: string
  readonly packs: readonly string[]
}

const presetsOf = (catalog: readonly Pack[]): readonly SetupPreset[] => [
  { id: 'essentials', title: 'Essentials', packs: [] },
  { id: 'daily', title: 'Daily work', packs: ['transcript', 'versioning', 'knowledge'] },
  { id: 'team', title: 'Team on GitHub', packs: ['transcript', 'versioning', 'knowledge', 'github', 'planning'] },
  { id: 'everything', title: 'Every pack', packs: catalog.filter(pack => !pack.core).map(pack => pack.id) },
]

const setupRequestSchema = Schema.Struct({
  profile: profileNameSchema,
  packs: Schema.Array(Schema.String),
  extend: Schema.Boolean,
})
export type SetupRequest = typeof setupRequestSchema.Type

/**
 * `<profile>/dshfiles-setup.json`: written when `dshx setup` composes a profile, so the onboarding plugin knows the user
 * chose these plugins outside DSH and shows them as chosen instead of revealing them progressively (decision 2).
 */
const markerSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  composedBy: Schema.Literal('dshx setup'),
  packs: Schema.Array(Schema.String),
})

export interface SetupProblem {
  readonly message: string
  readonly hint: string
}

export interface SetupPlanResult {
  readonly plan: InitProfilePlan | null
  /** Why nothing can be applied: a seeded or served profile, or a request ProfileInit refuses. */
  readonly problem: SetupProblem | null
  readonly marker: { readonly path: string; readonly packs: readonly string[] } | null
  /** Composed plugins with no build output yet: the profile links them but DSH cannot load them until they are built. */
  readonly unbuilt: readonly string[]
  readonly buildCommand: string | null
  readonly startCommand: string
  readonly hash: string
}

export interface SetupContext {
  readonly root: string
  readonly dshHome: string
  readonly env: NodeJS.ProcessEnv
  readonly runningHosts: (profile: string) => Promise<readonly number[]>
  readonly dependencies?: ProfilePluginDependencies
}

const applyRequestSchema = Schema.Struct({ request: setupRequestSchema, hash: Schema.String })

/** One NDJSON line of `/api/apply`. */
export type ApplyEvent =
  | { readonly type: 'step'; readonly step: SetupStep }
  | { readonly type: 'done'; readonly result: SetupPlanResult }
  | { readonly type: 'error'; readonly error: SetupProblem }

/** What `/api/state` returns: the checks, the packs and presets read live from the checkout, the existing profiles. */
export interface SetupStateView {
  readonly checks: readonly SetupCheck[]
  readonly blocking: boolean
  readonly packs: readonly Pick<Pack, 'id' | 'title' | 'summary' | 'core' | 'plugins'>[]
  readonly presets: readonly SetupPreset[]
  readonly profiles: readonly ExistingProfile[]
  readonly dshHome: string
  readonly defaults: { readonly profile: string; readonly preset: string; readonly packs: readonly string[] | undefined }
}

export interface SetupStep {
  readonly id: 'compose' | 'record'
  readonly label: string
  readonly status: 'running' | 'done' | 'failed'
}

const shellQuote = (value: string): string => (/^[\w./:=@-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)

const startCommandOf = async (context: SetupContext, profile: string): Promise<string> => {
  const nodeVersion = existsSync(join(context.root, '.node-version')) ? (await readFile(join(context.root, '.node-version'), 'utf8')).trim() : ''
  const dsh = await resolveDshExecutable(undefined, context.env, context.root)
  const defaultHome = context.env.HOME === undefined ? undefined : join(context.env.HOME, '.dsh')
  const home = context.dshHome === defaultHome ? '' : `DSH_HOME=${shellQuote(context.dshHome)} `
  return `${home}fnm exec --using=${nodeVersion} ${shellQuote(dsh)} --profile ${shellQuote(profile)} web`
}

const problemOf = async (context: SetupContext, request: SetupRequest): Promise<SetupProblem | null> => {
  if (existsSync(join(context.root, 'profiles', request.profile)))
    return {
      message: `Profile ${request.profile} follows the repository: it holds every plugin and resyncs before each start.`,
      hint: 'Choose another name; setup writes main by default.',
    }
  if ((await context.runningHosts(request.profile)).length > 0)
    return {
      message: `A running DSH serves profile ${request.profile}, so setup leaves it alone.`,
      hint: 'Stop that DSH yourself, or choose another profile name.',
    }
  return null
}

const readMarker = async (path: string): Promise<readonly string[] | undefined> =>
  existsSync(path) ? decodeJson(markerSchema, await readFile(path, 'utf8')).packs : undefined

/** The marker this request would write: on a profile setup creates, or one setup created whose packs grow. */
const markerOf = async (plan: InitProfilePlan): Promise<SetupPlanResult['marker']> => {
  const path = join(plan.profileRoot, SetupChecks.markerFile)
  const chosen = plan.packs.map(pack => pack.id)
  const recorded = await readMarker(path)
  if (recorded === undefined) return plan.created ? { path, packs: chosen } : null
  const packs = [...new Set([...recorded, ...chosen])]
  return packs.length === recorded.length ? null : { path, packs }
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex')

const unbuiltOf = (root: string, plugins: readonly string[]): readonly string[] => plugins.filter(plugin => !existsSync(join(root, 'plugins', plugin, 'dist')))

/** The exact preview: `ProfileInit.apply` as a dry run, plus the setup marker; writes nothing. */
const planOf = async (context: SetupContext, request: SetupRequest): Promise<SetupPlanResult> => {
  const startCommand = await startCommandOf(context, request.profile)
  const empty = { plan: null, marker: null, unbuilt: [], buildCommand: null, startCommand }
  const problem = await problemOf(context, request)
  if (problem !== null) return { ...empty, problem, hash: hashOf(JSON.stringify(problem)) }
  try {
    const catalog = await ProfileInit.loadPacks()
    const plan = await ProfileInit.apply(
      { catalog, packs: request.packs, profile: request.profile, dshHome: context.dshHome, extend: request.extend, dryRun: true },
      context.dependencies,
    )
    const marker = await markerOf(plan)
    const unbuilt = unbuiltOf(context.root, plan.plugins)
    const buildCommand =
      unbuilt.length === 0
        ? null
        : `cd ${shellQuote(context.root)} && node scripts/turbo.mjs run build ${unbuilt.map(plugin => `--filter=${plugin}`).join(' ')}`
    const hash = hashOf(
      JSON.stringify({ plugins: plan.plugins, linked: plan.linked, files: plan.files, commands: plan.commands, created: plan.created, marker }),
    )
    return { plan, problem: null, marker, unbuilt, buildCommand, startCommand, hash }
  } catch (error) {
    if (error instanceof PackSelectionError || error instanceof ProfilePluginError) {
      const refused = { message: error.message, hint: error.hint }
      return { ...empty, problem: refused, hash: hashOf(JSON.stringify(refused)) }
    }
    throw error
  }
}

/**
 * Apply exactly the plan the user reviewed: re-plan, refuse when anything changed since, then compose through
 * `ProfileInit.apply` (profile-sync `--bundle`) and record the setup marker. Never removes a plugin, never starts DSH.
 */
const applyPlan = async (
  context: SetupContext,
  input: { readonly request: SetupRequest; readonly hash: string; readonly onStep: (step: SetupStep) => void },
): Promise<SetupPlanResult> => {
  const reviewed = await planOf(context, input.request)
  if (reviewed.problem !== null) throw new ProfilePluginError(reviewed.problem.message, reviewed.problem.hint)
  if (reviewed.hash !== input.hash)
    throw new ProfilePluginError('The profile changed since you reviewed the plan; nothing was written.', 'Go back to Review and check the new plan.')
  const compose: SetupStep = {
    id: 'compose',
    label: `Link ${String(reviewed.plan?.plugins.length ?? 0)} plugins into ${input.request.profile}`,
    status: 'running',
  }
  input.onStep(compose)
  try {
    const catalog = await ProfileInit.loadPacks()
    await ProfileInit.apply(
      { catalog, packs: input.request.packs, profile: input.request.profile, dshHome: context.dshHome, extend: input.request.extend, dryRun: false },
      context.dependencies,
    )
  } catch (error) {
    input.onStep({ ...compose, status: 'failed' })
    throw error
  }
  input.onStep({ ...compose, status: 'done' })
  if (reviewed.marker !== null) {
    const record: SetupStep = { id: 'record', label: 'Record that setup chose these plugins', status: 'running' }
    input.onStep(record)
    const marker = { schemaVersion: 1, composedBy: 'dshx setup', packs: reviewed.marker.packs } satisfies typeof markerSchema.Type
    await writeFileAtomic(reviewed.marker.path, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 })
    input.onStep({ ...record, status: 'done' })
  }
  return reviewed
}

/** The presets, plan and apply behind `dshx setup`, over `ProfileInit` so the CLI and the web app write the same profile. */
export class SetupPlan {
  static readonly requestSchema = setupRequestSchema
  static readonly applySchema = applyRequestSchema
  static readonly defaultProfile = 'main'
  static readonly defaultPreset = 'daily'
  static readonly presets = presetsOf
  static readonly plan = planOf
  static readonly apply = applyPlan
}
