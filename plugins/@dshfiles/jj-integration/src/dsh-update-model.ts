import { Schema } from 'effect'
import { workspaceSyncSchema } from './api-effect-schemas.js'

/**
 * Update DSH (productivity pass E3): bring the checkout DSH runs from onto the newest `main@origin` through the
 * supported `dshx checkout sync`, then leave the restart to the user. Schemas and the pure steps live here so the
 * Host service, the API contract and the client read one shape.
 */

const text = (max: number) => Schema.String.check(Schema.isMaxLength(max))

export const updateRevisionSchema = Schema.Struct({
  changeId: text(64),
  commitId: text(128),
  description: text(400),
  author: text(200),
  /** ISO time the revision was committed. */
  timestamp: text(64),
})
export type UpdateRevision = typeof updateRevisionSchema.Type

/** What moving the checkout would install, rebuild and restart, from `dshx checkout plan`. */
export const checkoutPlanSchema = Schema.Struct({
  changedFiles: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  installs: Schema.Array(text(400)).check(Schema.isMaxLength(50)),
  rebuildsDshx: Schema.Boolean,
  plugins: Schema.Array(Schema.Struct({ name: text(200), host: Schema.Boolean, client: Schema.Boolean })).check(Schema.isMaxLength(500)),
  restartNeeded: Schema.Boolean,
  restartReasons: Schema.Array(text(400)).check(Schema.isMaxLength(500)),
})
export type CheckoutPlanView = typeof checkoutPlanSchema.Type

export const updateJobSchema = Schema.Struct({
  id: text(64),
  /** `refused` stopped before changing anything (diverged history, local work the sync keeps): see `message`. */
  state: Schema.Literals(['running', 'done', 'failed', 'refused']),
  phase: Schema.Literals(['fetching', 'syncing', 'done']),
  startedAt: Schema.Number,
  finishedAt: Schema.NullOr(Schema.Number),
  /** The checkout's working-copy parent before and the commit it moved to. */
  from: Schema.NullOr(text(128)),
  to: Schema.NullOr(text(128)),
  /** The newest `dshx checkout sync` progress lines, oldest first. */
  progress: Schema.Array(text(400)).check(Schema.isMaxLength(20)),
  sync: Schema.NullOr(workspaceSyncSchema),
  message: Schema.NullOr(text(2000)),
})
export type UpdateJobView = typeof updateJobSchema.Type

export const originRelationSchema = Schema.Literals(['same', 'origin-ahead', 'local-ahead', 'diverged', 'no-remote'])
export type OriginRelation = typeof originRelationSchema.Type

export const updateCheckSchema = Schema.Struct({
  /** The checkout Update DSH moves; null with `unavailable` saying why and what to set. */
  checkout: Schema.NullOr(Schema.Struct({ path: text(4096), workspace: text(200), bookmark: text(200), remote: text(200) })),
  unavailable: Schema.NullOr(text(2000)),
  fetch: Schema.NullOr(
    Schema.Struct({ status: Schema.Literals(['fetched', 'fast-forwarded', 'no-remote', 'failed']), message: Schema.NullOr(text(2000)), at: Schema.Number }),
  ),
  /** The local bookmark against its remote copy. */
  origin: originRelationSchema,
  /** The commit the checkout would move to: the remote tip when it is ahead, else the local bookmark. */
  target: Schema.NullOr(text(128)),
  /** "What's new": revisions the target has and the checkout does not, newest first (at most 50). */
  incoming: Schema.Array(updateRevisionSchema).check(Schema.isMaxLength(50)),
  incomingCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  /** Revisions on the local bookmark the remote does not have (never pushed). */
  localOnly: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  plan: Schema.NullOr(checkoutPlanSchema),
  planError: Schema.NullOr(text(2000)),
  canApply: Schema.Boolean,
  /** Why Apply is not offered, with the recovery. */
  blocked: Schema.NullOr(text(2000)),
  /** The same update by hand, for a dry-run preview or a checkout this plugin will not touch. */
  commands: Schema.Array(text(2000)).check(Schema.isMaxLength(10)),
  job: Schema.NullOr(updateJobSchema),
})
export type UpdateCheckView = typeof updateCheckSchema.Type

/** Try this change live: what landing one thread would change in the running DSH, read only. */
export const landImpactSchema = Schema.Struct({
  /** False when landing this thread changes nothing DSH runs (another repository, nothing to land, no checkout). */
  applies: Schema.Boolean,
  reason: Schema.NullOr(text(2000)),
  checkout: Schema.NullOr(Schema.Struct({ path: text(4096), workspace: text(200) })),
  /** The thread's newest landable commit, the revision the plan moves the checkout to. */
  head: Schema.NullOr(text(128)),
  plan: Schema.NullOr(checkoutPlanSchema),
})
export type LandImpactView = typeof landImpactSchema.Type

/** hmr-gate's rule, applied to the plan: client-only bundles hot-reload, a changed Host half waits for a restart. */
interface ImpactGroups {
  readonly live: readonly string[]
  readonly restart: readonly string[]
}

const impactGroups = (plan: CheckoutPlanView): ImpactGroups => ({
  live: plan.plugins.filter(plugin => plugin.client && !plugin.host).map(plugin => plugin.name),
  restart: plan.plugins.filter(plugin => plugin.host).map(plugin => plugin.name),
})

const renderImpact = (impact: LandImpactView): string => {
  if (!impact.applies || impact.plan === null) return impact.reason ?? 'Landing this thread changes nothing in the running DSH.'
  const groups = impactGroups(impact.plan)
  return [
    `Landing this thread moves the running DSH checkout (${impact.checkout?.workspace ?? 'default'}) by ${String(impact.plan.changedFiles)} file(s).`,
    `Hot-reloads without a restart: ${groups.live.join(', ') || 'nothing'}.`,
    `Needs Restart when idle: ${groups.restart.join(', ') || (impact.plan.restartNeeded ? impact.plan.restartReasons.join('; ') : 'nothing')}.`,
    impact.plan.installs.length === 0 ? undefined : `Reinstalls dependencies in ${impact.plan.installs.join(', ')}.`,
    'Nothing changes until the thread lands; the checkout then syncs in the background and never restarts by itself.',
  ]
    .filter(line => line !== undefined)
    .join('\n')
}

const quote = (value: string): string => (/^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)

/** The update as shell commands: fetch, fast-forward the bookmark when the remote is ahead, then the supported sync. */
const commands = (input: {
  readonly path: string
  readonly workspace: string
  readonly bookmark: string
  readonly remote: string
  readonly origin: OriginRelation
  readonly dshxBin: string
}): readonly string[] => [
  `cd ${quote(input.path)}`,
  `jj git fetch --remote ${quote(input.remote)}`,
  ...(input.origin === 'origin-ahead' ? [`jj bookmark set ${quote(input.bookmark)} -r ${quote(`${input.bookmark}@${input.remote}`)}`] : []),
  `node ${quote(input.dshxBin)} checkout sync --workspace ${quote(input.workspace)} --bookmark ${quote(input.bookmark)} --cwd ${quote(input.path)}`,
]

/** Whether Apply may run, and when not, why, in the order a person would fix it. */
const blocked = (input: {
  readonly origin: OriginRelation
  readonly incomingCount: number
  readonly localOnly: number
  readonly bookmark: string
  readonly remote: string
  readonly path: string
  readonly running: boolean
}): string | null => {
  if (input.running) return 'An update is already running; its progress is below.'
  if (input.origin === 'diverged')
    return `${input.bookmark} and ${input.bookmark}@${input.remote} have diverged: ${String(input.localOnly)} local revision${input.localOnly === 1 ? '' : 's'} the remote lacks, and the remote has work ${input.bookmark} lacks. Update DSH moves only along one line of history, so it stops here and changes nothing. In ${input.path}, rebase the local work onto the remote (\`jj rebase -b ${input.bookmark} -d ${input.bookmark}@${input.remote}\`; when jj says ${input.bookmark} is conflicted, first pick your local revision with \`jj bookmark set ${input.bookmark} -r <commit>\`) or push it, then check again.`
  return null
}

/** One line for the status strip and the agent: "3 new revisions", "Up to date", "Updating…". */
const headline = (check: UpdateCheckView): string => {
  if (check.job?.state === 'running') return check.job.phase === 'fetching' ? 'Updating DSH: fetching…' : 'Updating DSH: syncing and rebuilding…'
  if (check.checkout === null) return 'Update DSH is unavailable'
  if (check.incomingCount === 0) return 'DSH is up to date'
  return `${String(check.incomingCount)} new revision${check.incomingCount === 1 ? '' : 's'} for DSH`
}

/** The tool text for `dsh_update_check` and `dsh_update_apply`: state, What's new, impact, and the next step. */
const render = (check: UpdateCheckView): string => {
  const lines = [headline(check)]
  if (check.unavailable !== null) lines.push(check.unavailable)
  if (check.checkout !== null)
    lines.push(
      `Checkout ${check.checkout.workspace} at ${check.checkout.path}; ${check.checkout.bookmark} vs ${check.checkout.bookmark}@${check.checkout.remote}: ${check.origin}.`,
    )
  if (check.fetch !== null) lines.push(`Fetch: ${check.fetch.status}${check.fetch.message === null ? '' : ` (${check.fetch.message})`}.`)
  for (const revision of check.incoming.slice(0, 20)) lines.push(`- ${revision.changeId} ${revision.description || '(no description)'} · ${revision.author}`)
  if (check.incomingCount > 20) lines.push(`… and ${String(check.incomingCount - 20)} more.`)
  if (check.plan !== null) {
    const hot = check.plan.plugins.filter(plugin => plugin.client && !plugin.host).map(plugin => plugin.name)
    const host = check.plan.plugins.filter(plugin => plugin.host).map(plugin => plugin.name)
    lines.push(
      `Rebuilds: ${check.plan.plugins.length === 0 && !check.plan.rebuildsDshx ? 'nothing' : [...(check.plan.rebuildsDshx ? ['dshx'] : []), ...check.plan.plugins.map(plugin => plugin.name)].join(', ')}.`,
    )
    if (hot.length > 0) lines.push(`Hot-reloads: ${hot.join(', ')}.`)
    lines.push(
      check.plan.restartNeeded
        ? `Restart needed afterwards (${host.join(', ') || check.plan.restartReasons.join('; ')}); use Restart when idle.`
        : 'No restart needed.',
    )
  }
  if (check.planError !== null) lines.push(`Could not predict the rebuild: ${check.planError}`)
  if (check.blocked !== null) lines.push(check.blocked)
  if (check.job !== null) {
    const job = check.job
    lines.push(`Last update ${job.id}: ${job.state}/${job.phase}${job.message === null ? '' : ` — ${job.message}`}`)
    if (job.sync !== null) {
      if (job.sync.pluginsRebuilt.length > 0) lines.push(`Rebuilt: ${job.sync.pluginsRebuilt.join(', ')}.`)
      if (job.state === 'done')
        lines.push(job.sync.restartNeeded ? 'DSH needs a restart to load it: Restart when idle in the status strip.' : 'Applied without a restart.')
    }
  }
  if (check.canApply) lines.push('Apply with dsh_update_apply (confirm: true) only when the user asked to update DSH.')
  else if (check.checkout !== null && check.incomingCount > 0) lines.push(`By hand:\n${check.commands.join('\n')}`)
  return lines.join('\n')
}

/** `dshx checkout plan --json` data, narrowed to what the views show. */
const planView = (data: {
  readonly changedFiles: readonly string[]
  readonly installs: readonly string[]
  readonly rebuilt: { readonly dshx: boolean }
  readonly plugins: readonly { readonly name: string; readonly host: boolean; readonly client: boolean }[]
  readonly restart: { readonly needed: boolean; readonly reasons: readonly string[] }
}): CheckoutPlanView => ({
  changedFiles: data.changedFiles.length,
  installs: data.installs.slice(0, 50),
  rebuildsDshx: data.rebuilt.dshx,
  plugins: data.plugins.slice(0, 500).map(plugin => ({ name: plugin.name, host: plugin.host, client: plugin.client })),
  restartNeeded: data.restart.needed,
  restartReasons: data.restart.reasons.slice(0, 500).map(reason => reason.slice(0, 400)),
})

export class DshUpdateModel {
  static readonly commands = commands
  static readonly blocked = blocked
  static readonly headline = headline
  static readonly render = render
  static readonly planView = planView
  static readonly impactGroups = impactGroups
  static readonly renderImpact = renderImpact
}
