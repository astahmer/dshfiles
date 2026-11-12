import { Jj } from '@dshfiles/jj-cli'
import { Clock, Context, Duration, Effect, FiberSet, FileSystem, Layer, Option, Ref, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AutoFetchModel, type FetchOutcome } from './auto-fetch.js'
import {
  DshUpdateModel,
  type CheckoutPlanView,
  type LandImpactView,
  type OriginRelation,
  type UpdateCheckView,
  type UpdateJobView,
  type UpdateRevision,
} from './dsh-update-model.js'
import { ActivityLog } from './host-edges-promise.js'
import { JjSettings } from './jj-settings.js'
import { ThreadWorkspaceModel } from './thread-workspace-model.js'
import { WorkspaceSync } from './workspace-sync.js'

const JJ_READ_TIMEOUT = Duration.seconds(60)
const PLAN_TIMEOUT = Duration.minutes(2)
const MAX_INCOMING = 50
const MAX_PROGRESS = 20
const MAX_PLAN_BYTES = 1024 * 1024
const REVISION_TEMPLATE =
  'change_id.short(12) ++ "\\t" ++ commit_id ++ "\\t" ++ author.name() ++ "\\t" ++ committer.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ") ++ "\\t" ++ description.first_line() ++ "\\n"'

/** The folder this Host bundle was loaded from: with no setting, the checkout DSH runs from contains it. */
const pluginDirectory = (): string => dirname(fileURLToPath(import.meta.url))

const remoteRevset = (bookmark: string, remote: string): string => `remote_bookmarks(exact:${JSON.stringify(bookmark)}, exact:${JSON.stringify(remote)})`
const localRevset = (bookmark: string): string => `bookmarks(exact:${JSON.stringify(bookmark)})`
const commitRevset = (commitId: string): string => `commit_id(${JSON.stringify(commitId)})`

const planDataSchema = Schema.Struct({
  ok: Schema.Boolean,
  data: Schema.optional(
    Schema.Struct({
      changedFiles: Schema.Array(Schema.String),
      installs: Schema.Array(Schema.String),
      rebuilt: Schema.Struct({ dshx: Schema.Boolean, plugins: Schema.Array(Schema.String) }),
      plugins: Schema.Array(Schema.Struct({ name: Schema.String, host: Schema.Boolean, client: Schema.Boolean })),
      restart: Schema.Struct({ needed: Schema.Boolean, reasons: Schema.Array(Schema.String) }),
    }),
  ),
  error: Schema.optional(Schema.Struct({ message: Schema.String, hint: Schema.String })),
})
const decodePlan = Schema.decodeUnknownOption(Schema.fromJsonString(planDataSchema))

export interface CheckoutTarget {
  readonly path: string
  readonly workspace: string
  readonly bookmark: string
  readonly remote: string
}

/** Where Update DSH works, or why it cannot, with the setting that fixes it. */
type Resolved = { readonly _tag: 'ok'; readonly target: CheckoutTarget } | { readonly _tag: 'unavailable'; readonly reason: string }

/**
 * Update DSH: check `main@origin` for the checkout DSH runs from (What's new and what it would rebuild), then fetch,
 * fast-forward the bookmark and run the same `dshx checkout sync` a land runs, as one background job whose progress and
 * outcome stay readable. It never pushes, never moves a bookmark backwards or across diverged history, and never
 * restarts DSH: a Host bundle change ends with "restart needed", which the existing Restart when idle applies.
 */
export class DshUpdate extends Context.Service<
  DshUpdate,
  {
    readonly check: (input: { readonly fetch: boolean }) => Effect.Effect<UpdateCheckView>
    readonly apply: Effect.Effect<{ readonly job: UpdateJobView | null; readonly check: UpdateCheckView }>
    /** Try this change live: what landing the thread at `path` would change in the running DSH. Read only. */
    readonly landImpact: (path: string) => Effect.Effect<LandImpactView>
    /** `dshx checkout plan` for one revision against the checkout DSH runs from (Try this change live). */
    readonly planFor: (
      revision: string,
    ) => Effect.Effect<
      { readonly target: CheckoutTarget; readonly plan: CheckoutPlanView } | { readonly target: CheckoutTarget | null; readonly error: string }
    >
  }
>()('@dshfiles/jj-integration/DshUpdate') {
  static readonly layer = Layer.effect(
    DshUpdate,
    Effect.gen(function* () {
      const settings = yield* JjSettings
      const jj = yield* Jj
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fileSystem = yield* FileSystem.FileSystem
      const sync = yield* WorkspaceSync
      const activity = yield* ActivityLog
      const jobs = yield* FiberSet.make<void>()
      const job = yield* Ref.make<UpdateJobView | null>(null)
      const lastFetch = yield* Ref.make<UpdateCheckView['fetch']>(null)

      const read = (args: readonly string[], cwd: string) =>
        jj
          .run({ args: ['--ignore-working-copy', ...args], cwd, timeout: JJ_READ_TIMEOUT })
          .pipe(Effect.catch(error => Effect.succeed({ exitCode: 1, stdout: '', stdoutTruncated: false, stderr: error.message, stderrTruncated: false })))
      const lines = (output: { readonly exitCode: number; readonly stdout: string }): readonly string[] =>
        output.exitCode === 0 ? output.stdout.split('\n').filter(line => line.length > 0) : []
      const commitOf = (revset: string, cwd: string) =>
        Effect.map(read(['log', '--no-graph', '-r', `present(${revset})`, '-T', 'commit_id ++ "\\n"'], cwd), output => {
          const found = lines(output)
          return found.length === 1 ? Option.fromUndefinedOr(found[0]) : Option.none<string>()
        })
      const count = (revset: string, cwd: string) => Effect.map(read(['log', '--no-graph', '-r', revset, '-T', '"x\\n"'], cwd), output => lines(output).length)
      const isAncestor = (ancestor: string, of: string, cwd: string) =>
        Effect.map(count(`${commitRevset(ancestor)} & ::${commitRevset(of)}`, cwd), found => found > 0)

      const resolve = Effect.gen(function* () {
        const current = yield* settings.get
        const configured = current.updateCheckout.trim()
        const start = configured === '' ? pluginDirectory() : configured
        const workspace = current.syncWorkspaceAfterLand.trim() || 'default'
        const remote = current.autoFetch.remote.trim() || 'origin'
        const settingHint = 'Set Settings › Thread workspaces › Update checkout to the folder of the jj checkout DSH runs from.'
        if (!(yield* fileSystem.exists(start).pipe(Effect.orElseSucceed(() => false))))
          return { _tag: 'unavailable', reason: `${start} does not exist. ${settingHint}` } satisfies Resolved
        const root = yield* read(['workspace', 'root', '--name', workspace], start)
        if (root.exitCode !== 0)
          return {
            _tag: 'unavailable',
            reason: `DSH does not run from a jj checkout with a workspace named "${workspace}" (looked in ${start}). ${settingHint} A registry install updates with \`dsh plugin add\` instead.`,
          } satisfies Resolved
        return { _tag: 'ok', target: { path: root.stdout.trim(), workspace, bookmark: current.bookmark.trim() || 'main', remote } } satisfies Resolved
      })

      /** The bookmark against its remote copy, and the commit the checkout would move to. */
      const relate = (target: CheckoutTarget) =>
        Effect.gen(function* () {
          // A bookmark both sides moved is conflicted after a fetch (two targets): that is diverged history, never "no bookmark".
          const locals = lines(yield* read(['log', '--no-graph', '-r', `present(${localRevset(target.bookmark)})`, '-T', 'commit_id ++ "\\n"'], target.path))
          if (locals.length > 1) return { origin: 'diverged' as OriginRelation, tip: null, localOnly: locals.length - 1 }
          const local = Option.fromUndefinedOr(locals[0])
          const remote = yield* commitOf(remoteRevset(target.bookmark, target.remote), target.path)
          if (Option.isNone(remote)) return { origin: 'no-remote' as OriginRelation, tip: Option.getOrNull(local), localOnly: 0 }
          if (Option.isNone(local)) return { origin: 'origin-ahead' as OriginRelation, tip: remote.value, localOnly: 0 }
          const localOnly = yield* count(`::${commitRevset(local.value)} ~ ::${commitRevset(remote.value)}`, target.path)
          if (local.value === remote.value) return { origin: 'same' as OriginRelation, tip: local.value, localOnly }
          if (yield* isAncestor(local.value, remote.value, target.path)) return { origin: 'origin-ahead' as OriginRelation, tip: remote.value, localOnly }
          if (yield* isAncestor(remote.value, local.value, target.path)) return { origin: 'local-ahead' as OriginRelation, tip: local.value, localOnly }
          return { origin: 'diverged' as OriginRelation, tip: local.value, localOnly }
        })

      const planFor = (target: CheckoutTarget, revision: string) =>
        Effect.gen(function* () {
          const [executable = '', ...args] = ThreadWorkspaceModel.checkoutPlanArgv({ repoRoot: target.path, workspace: target.workspace, revision })
          const output = yield* spawner
            .spawn(ChildProcess.make(executable, args, { cwd: target.path, stdin: 'ignore', forceKillAfter: Duration.seconds(5) }))
            .pipe(
              Effect.flatMap(handle =>
                Effect.all(
                  [
                    handle.stdout.pipe(
                      Stream.decodeText(),
                      Stream.runFold(
                        () => '',
                        (text, chunk) => `${text}${chunk}`.slice(0, MAX_PLAN_BYTES),
                      ),
                    ),
                    Effect.ignore(handle.exitCode),
                  ],
                  { concurrency: 'unbounded' },
                ),
              ),
              Effect.scoped,
              Effect.timeoutOption(PLAN_TIMEOUT),
              Effect.orElseSucceed(() => Option.none<readonly [string, void]>()),
            )
          if (Option.isNone(output)) return { error: 'dshx checkout plan did not answer in time.' } as const
          const decoded = decodePlan(output.value[0])
          if (Option.isNone(decoded)) return { error: 'dshx checkout plan printed nothing this plugin can read; rebuild dshx.' } as const
          if (decoded.value.data === undefined)
            return {
              error: decoded.value.error === undefined ? 'dshx checkout plan failed.' : `${decoded.value.error.message} ${decoded.value.error.hint}`,
            } as const
          return { plan: DshUpdateModel.planView(decoded.value.data) } as const
        }).pipe(Effect.withSpan('jj-integration dsh update plan'))

      const incoming = (target: CheckoutTarget, tip: string) =>
        Effect.gen(function* () {
          const revset = `(::${commitRevset(tip)}) ~ (::${target.workspace}@) ~ (empty() & description(exact:""))`
          const listed = yield* read(['log', '--no-graph', '-n', String(MAX_INCOMING), '-r', revset, '-T', REVISION_TEMPLATE], target.path)
          const revisions = lines(listed).map((line): UpdateRevision => {
            const [changeId = '', commitId = '', author = '', timestamp = '', ...description] = line.split('\t')
            return { changeId, commitId, author: author.slice(0, 200), timestamp, description: description.join('\t').slice(0, 400) }
          })
          const total = revisions.length < MAX_INCOMING ? revisions.length : yield* count(revset, target.path)
          return { revisions, total }
        })

      const fetchView = (outcome: FetchOutcome, at: number, remote: string): NonNullable<UpdateCheckView['fetch']> => ({
        status: outcome.status === 'fast-forwarded' ? 'fast-forwarded' : outcome.status,
        message: outcome.status === 'failed' ? AutoFetchModel.failureDetail(outcome, remote).slice(0, 2000) : null,
        at,
      })

      const check = Effect.fn('jj-integration dsh update check')(function* (input: { readonly fetch: boolean }) {
        const resolved = yield* resolve
        const currentJob = yield* Ref.get(job)
        if (resolved._tag === 'unavailable')
          return {
            checkout: null,
            unavailable: resolved.reason,
            fetch: null,
            origin: 'no-remote',
            target: null,
            incoming: [],
            incomingCount: 0,
            localOnly: 0,
            plan: null,
            planError: null,
            canApply: false,
            blocked: null,
            commands: [],
            job: currentJob,
          } satisfies UpdateCheckView
        const target = resolved.target
        yield* Effect.annotateCurrentSpan({ 'dshx.update.fetch': input.fetch, 'dshx.checkout.workspace': target.workspace })
        // A check never fast-forwards: only Apply moves the bookmark.
        if (input.fetch && currentJob?.state !== 'running') {
          const outcome = yield* AutoFetchModel.fetchRepository({
            repoRoot: target.path,
            remote: target.remote,
            bookmark: target.bookmark,
            fastForward: false,
          }).pipe(Effect.provideService(Jj, jj))
          yield* Ref.set(lastFetch, fetchView(outcome, yield* Clock.currentTimeMillis, target.remote))
        }
        const relation = yield* relate(target)
        const news = relation.tip === null ? { revisions: [], total: 0 } : yield* incoming(target, relation.tip)
        const planned = news.total === 0 || relation.tip === null ? undefined : yield* planFor(target, relation.tip)
        const running = currentJob?.state === 'running'
        const blocked = DshUpdateModel.blocked({
          ...relation,
          incomingCount: news.total,
          bookmark: target.bookmark,
          remote: target.remote,
          path: target.path,
          running,
        })
        yield* Effect.annotateCurrentSpan({ 'dshx.update.incoming': news.total, 'dshx.update.origin': relation.origin })
        return {
          checkout: target,
          unavailable: null,
          fetch: yield* Ref.get(lastFetch),
          origin: relation.origin,
          target: relation.tip,
          incoming: news.revisions,
          incomingCount: news.total,
          localOnly: relation.localOnly,
          plan: planned !== undefined && 'plan' in planned ? planned.plan : null,
          planError: planned !== undefined && 'error' in planned ? planned.error : null,
          canApply: news.total > 0 && blocked === null,
          blocked,
          commands: DshUpdateModel.commands({ ...target, origin: relation.origin, dshxBin: ThreadWorkspaceModel.dshxBin() }),
          job: currentJob,
        } satisfies UpdateCheckView
      })

      const update = (patch: Partial<UpdateJobView>) => Ref.update(job, current => (current === null ? current : { ...current, ...patch }))
      const finish = (state: UpdateJobView['state'], message: string | null) =>
        Effect.gen(function* () {
          yield* update({ state, phase: 'done', message, finishedAt: yield* Clock.currentTimeMillis })
        })

      const runJob = (target: CheckoutTarget) =>
        Effect.gen(function* () {
          const outcome = yield* AutoFetchModel.fetchRepository({
            repoRoot: target.path,
            remote: target.remote,
            bookmark: target.bookmark,
            fastForward: true,
          }).pipe(Effect.provideService(Jj, jj))
          yield* Ref.set(lastFetch, fetchView(outcome, yield* Clock.currentTimeMillis, target.remote))
          if (outcome.status === 'failed') return yield* finish('failed', AutoFetchModel.failureDetail(outcome, target.remote))
          const relation = yield* relate(target)
          if (relation.origin === 'diverged')
            return yield* finish(
              'refused',
              DshUpdateModel.blocked({ ...relation, incomingCount: 1, bookmark: target.bookmark, remote: target.remote, path: target.path, running: false }),
            )
          yield* update({ phase: 'syncing', to: relation.tip })
          const result = yield* sync.syncNow({
            repoRoot: target.path,
            workspace: target.workspace,
            bookmark: target.bookmark,
            onProgress: line =>
              Ref.update(job, current =>
                current === null ? current : { ...current, progress: [...current.progress, line.slice(0, 400)].slice(-MAX_PROGRESS) },
              ),
          })
          yield* update({ sync: result })
          if (result.status === 'refused') return yield* finish('refused', result.message ?? 'The checkout carries local work the sync keeps; nothing changed.')
          if (result.state === 'failed') return yield* finish('failed', result.message ?? 'dshx checkout sync failed.')
          return yield* finish(
            'done',
            result.restartNeeded ? 'Updated. DSH needs a restart to load the new Host bundles: use Restart when idle.' : 'Updated and applied live.',
          )
        }).pipe(
          Effect.withSpan('jj-integration dsh update apply', { attributes: { 'dshx.checkout.workspace': target.workspace } }),
          Effect.ensuring(
            Effect.gen(function* () {
              const finished = yield* Ref.get(job)
              if (finished === null) return
              yield* activity.emit({
                type: finished.state === 'done' ? 'workspace.dsh_updated' : 'workspace.dsh_update_failed',
                level: finished.state === 'done' && finished.sync?.restartNeeded !== true ? 'notable' : 'attention',
                summary: `Update DSH ${finished.state}${finished.sync === null ? '' : ` · ${String(finished.sync.pluginsRebuilt.length)} plugin(s) rebuilt`}`,
                detail: finished.message ?? undefined,
                path: target.path,
              })
            }),
          ),
        )

      const apply = Effect.gen(function* () {
        const resolved = yield* resolve
        const existing = yield* Ref.get(job)
        if (existing?.state === 'running') return { job: existing, check: yield* check({ fetch: false }) }
        if (resolved._tag === 'unavailable') return { job: null, check: yield* check({ fetch: false }) }
        const now = yield* Clock.currentTimeMillis
        const from = yield* commitOf(`${resolved.target.workspace}@-`, resolved.target.path)
        const started: UpdateJobView = {
          id: `update-${String(now)}`,
          state: 'running',
          phase: 'fetching',
          startedAt: now,
          finishedAt: null,
          from: Option.getOrNull(from),
          to: null,
          progress: [],
          sync: null,
          message: null,
        }
        yield* Ref.set(job, started)
        yield* FiberSet.run(
          jobs,
          runJob(resolved.target).pipe(Effect.catchCause(cause => finish('failed', `Update DSH stopped: ${String(cause).slice(0, 600)}`))),
        )
        return { job: started, check: yield* check({ fetch: false }) }
      }).pipe(Effect.withSpan('jj-integration dsh update start'))

      const landImpact = Effect.fn('jj-integration land impact')(function* (path: string) {
        const resolved = yield* resolve
        const none = (reason: string, checkout: LandImpactView['checkout'] = null): LandImpactView => ({
          applies: false,
          reason,
          checkout,
          head: null,
          plan: null,
        })
        if (resolved._tag === 'unavailable') return none(resolved.reason)
        const target = resolved.target
        const checkout = { path: target.path, workspace: target.workspace }
        const heads = lines(
          yield* read(
            ['log', '--no-graph', '-r', `heads((${localRevset(target.bookmark)}..@) ~ (empty() & description(exact:"")))`, '-T', 'commit_id ++ "\\n"'],
            path,
          ),
        )
        const head = heads[0]
        if (head === undefined || heads.length > 1)
          return none(
            heads.length > 1 ? 'This thread has more than one head; land previews one line of work.' : `This thread has nothing to land on ${target.bookmark}.`,
            checkout,
          )
        if (Option.isNone(yield* commitOf(commitRevset(head), target.path)))
          return none("This thread's repository is not the checkout DSH runs from, so landing it changes nothing in the running DSH.", checkout)
        const planned = yield* planFor(target, head)
        yield* Effect.annotateCurrentSpan({ 'dshx.checkout.workspace': target.workspace, 'dshx.update.planned': 'plan' in planned })
        if ('error' in planned)
          return { applies: false, reason: `Could not predict the rebuild: ${planned.error}`, checkout, head, plan: null } satisfies LandImpactView
        return { applies: true, reason: null, checkout, head, plan: planned.plan } satisfies LandImpactView
      })

      return DshUpdate.of({
        check,
        apply,
        landImpact,
        planFor: revision =>
          Effect.gen(function* () {
            const resolved = yield* resolve
            if (resolved._tag === 'unavailable') return { target: null, error: resolved.reason }
            const planned = yield* planFor(resolved.target, revision)
            return 'plan' in planned ? { target: resolved.target, plan: planned.plan } : { target: resolved.target, error: planned.error }
          }),
      })
    }),
  )
}
