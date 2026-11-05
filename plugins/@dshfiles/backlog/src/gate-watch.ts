import { DshxPlugin } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Jj } from '@dshfiles/jj-cli'
import { projectChecksApi } from '@dshfiles/project-checks/api'
import { Cause, Clock, Effect, Layer, Ref, Schedule } from 'effect'
import type { BacklogSummaryView } from './api.js'
import { BacklogSettingsTag } from './backlog-settings.js'
import { BacklogGates } from './gates.js'
import { AutomationHost } from './peer-replication.js'
import { PullRequestState } from './pull-request-state.js'
import { BacklogStore } from './store.js'

const MAX_REPOSITORIES = 10

/** One met condition, with the words the item's history shows for it. */
interface Resolution {
  readonly gateId: string
  readonly detail: string
}

const openStatuses = ['inbox', 'todo', 'doing'] as const

/** A revision id a user or agent may write: a change id, a commit id or a short prefix of either. */
const revisionPattern = /^[0-9a-z]{4,64}$/

/**
 * Resolves gates from what the Host already watches: pull requests through `@dshfiles/pull-requests`, revisions on
 * `main` with one jj read per repository, project-check receipts of the threads linked to the item, and the calendar
 * for date gates (derived on read, nothing to resolve). A linked pull request with relation `fixes` that merges moves
 * its item to done, unless you set the status by hand.
 */
export const GateWatch = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* BacklogStore
    const settings = yield* BacklogSettingsTag
    const pulls = yield* PullRequestState
    const jj = yield* Jj
    const apis = yield* HostApis
    const checks = apis.client(projectChecksApi)
    const automation = yield* AutomationHost
    const lastPoll = yield* Ref.make(0)

    const resolvePulls = Effect.fn('backlog gate pull requests')(function* (items: readonly BacklogSummaryView[]) {
      const urls = [
        ...new Set(
          items.flatMap(item => [
            ...item.gates.filter(gate => gate.open && gate.kind === 'pr').map(gate => gate.target),
            ...item.links.filter(link => link.type === 'url' && link.relation === 'fixes').map(link => link.target),
          ]),
        ),
      ]
      if (urls.length === 0) return
      const known = yield* pulls.of(urls)
      if (!known.available) return
      const merged = new Set(known.pullRequests.filter(pull => pull.state === 'merged').map(pull => pull.url))
      const isMerged = (url: string) => merged.has(BacklogGates.pullRequestOf(url)?.url ?? url)
      for (const item of items) {
        const resolved: Resolution[] = item.gates
          .filter(gate => gate.open && gate.kind === 'pr' && isMerged(gate.target))
          .map(gate => ({ gateId: gate.id, detail: 'merged' }))
        if (resolved.length > 0) yield* store.resolveGates({ id: item.id, resolved })
        for (const link of item.links.filter(candidate => candidate.type === 'url' && candidate.relation === 'fixes' && isMerged(candidate.target)))
          yield* store.applySignal({ id: item.id, status: 'done', link, reason: `fixed by ${BacklogGates.label({ kind: 'pr', target: link.target })}` })
      }
    })

    const onMain = (repository: string, revision: string) =>
      jj
        .exec({
          cwd: repository,
          args: ['--ignore-working-copy', 'log', '--no-graph', '-r', `present(${revision}) & ::main`, '-T', 'commit_id'],
          timeout: '20 seconds',
          maxStdoutBytes: 4_000,
        })
        .pipe(
          Effect.map(output => output.stdout.trim() !== ''),
          Effect.orElseSucceed(() => false),
        )

    const resolveRevisions = Effect.fn('backlog gate revisions')(function* (items: readonly BacklogSummaryView[], extra: readonly string[]) {
      const gated = items.filter(item => item.gates.some(gate => gate.open && gate.kind === 'revision'))
      if (gated.length === 0) return
      const repositories = [...new Set([...gated.flatMap(item => (item.project === null ? [] : [item.project])), ...extra])].slice(0, MAX_REPOSITORIES)
      yield* Effect.annotateCurrentSpan({ 'dshx.backlog.repositories': repositories.length })
      for (const item of gated) {
        const resolved: Resolution[] = []
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- the repositories are tried in order and the first that has the revision on main wins.
        for (const gate of item.gates.filter(candidate => candidate.open && candidate.kind === 'revision' && revisionPattern.test(candidate.target))) {
          const candidates = item.project === null ? repositories : [item.project, ...repositories.filter(repository => repository !== item.project)]
          for (const repository of candidates)
            if (yield* onMain(repository, gate.target)) {
              resolved.push({ gateId: gate.id, detail: 'on main' })
              break
            }
        }
        if (resolved.length > 0) yield* store.resolveGates({ id: item.id, resolved })
      }
    })

    const resolveChecks = Effect.fn('backlog gate checks')(function* (items: readonly BacklogSummaryView[]) {
      if (!(yield* apis.isServed(projectChecksApi))) return
      for (const summary of items.filter(item => item.gates.some(gate => gate.open && gate.kind === 'check'))) {
        const found = yield* store.get(summary.id)
        if (!found.ok) continue
        const item = found.value.item
        const threads = item.links.filter(link => link.type === 'thread').map(link => link.target)
        const receipts = (yield* Effect.forEach(threads, sessionId => checks.receipts({ sessionId }).pipe(Effect.orElseSucceed(() => [])))).flat()
        const resolved: Resolution[] = (item.gates ?? []).flatMap(gate => {
          if (gate.kind !== 'check' || gate.resolvedAt !== undefined) return []
          const passed = receipts.find(receipt => receipt.actionId === gate.target && receipt.status === 'passed' && receipt.finishedAt >= gate.createdAt)
          return passed === undefined ? [] : [{ gateId: gate.id, detail: `passed in ${passed.sessionId}` }]
        })
        if (resolved.length > 0) yield* store.resolveGates({ id: item.id, resolved })
      }
    })

    const tick = Effect.gen(function* () {
      const current = yield* settings.get
      const now = yield* Clock.currentTimeMillis
      if (!current.lifecycleSignals || now - (yield* Ref.get(lastPoll)) < current.revisionPollMinutes * 60_000) return
      yield* Ref.set(lastPoll, now)
      // Hosts that share the backlog would each resolve the same gate; only the automation Host writes it.
      if (!(yield* automation.here)) return yield* Effect.annotateCurrentSpan('dshx.backlog.automation', 'elsewhere')
      const items = (yield* store.list({ freshness: 'all', statuses: [...openStatuses], limit: 2_000 })).items
      yield* resolvePulls(items)
      yield* resolveRevisions(items, current.revisionRepositories)
      yield* resolveChecks(items)
    }).pipe(Effect.withSpan('backlog gate watch'))

    yield* DshxPlugin.worker(
      Effect.sleep('1 minute').pipe(
        Effect.andThen(
          Effect.repeat(
            tick.pipe(
              Effect.catchCause(cause => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logWarning('backlog gate watch failed', cause))),
            ),
            Schedule.spaced('1 minute'),
          ),
        ),
      ),
    )
  }),
)
