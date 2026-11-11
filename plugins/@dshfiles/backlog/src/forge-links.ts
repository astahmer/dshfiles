import { Context, Effect, Layer } from 'effect'
import type { BacklogSummaryView } from './api.js'
import type { BacklogWriteFailed } from './errors.js'
import { BacklogGates } from './gates.js'
import { PullRequestState, type PullRequestView } from './pull-request-state.js'
import { BacklogSignals } from './signals.js'
import { BacklogStore } from './store.js'

/** Item watches the backlog keeps at most: each costs one forge call per pull-requests sweep. */
const MAX_ITEM_WATCHES = 300

/** Close reasons that mean the work did not happen: such a closed issue leaves its item open, like an unmerged PR. */
const unfinishedIssueReasons = new Set(['NOT_PLANNED', 'DUPLICATE'])

/**
 * The item refs each merged pull request closes through its description (`Closes b:k3f9`), so the gate watch can close
 * items the PR names and not only the one it is linked to. A pull request still open closes nothing.
 */
export const mergedPullRequestClosers = (pullRequests: readonly PullRequestView[]): readonly { readonly url: string; readonly refs: readonly string[] }[] =>
  pullRequests.flatMap(pull => {
    if (pull.state !== 'merged' || pull.body === null) return []
    const refs = BacklogSignals.closedBy(pull.body)
    return refs.length === 0 ? [] : [{ url: pull.url, refs }]
  })

/** The pull requests one open item should watch: every PR link, whatever its relation, and its open PR gates. */
const pullRequestsOf = (item: BacklogSummaryView): readonly string[] => [
  ...new Set(
    [
      ...item.links.filter(link => link.type === 'url').map(link => link.target),
      ...item.gates.filter(gate => gate.open && gate.kind === 'pr').map(gate => gate.target),
    ].flatMap(url => BacklogGates.pullRequestOf(url)?.url ?? []),
  ),
]

const issueOf = BacklogGates.issueOf

const issueLinksOf = (item: BacklogSummaryView) => item.links.filter(link => link.type === 'url' && issueOf(link.target) !== null)

/**
 * Keeps the forge state of open items' links current with no thread involved: each linked pull request is watched by
 * its item through `@dshfiles/pull-requests` and released once the item is no longer open; linked GitHub issues are read
 * in batches. A `fixes` pull request that merges, or a `fixes` issue closed as completed, moves its item to done unless
 * you set the status by hand.
 */
export class ForgeLinks extends Context.Service<
  ForgeLinks,
  {
    /** Watches the PRs of these open items and releases every other item watch; answers what changed. */
    readonly syncWatches: (openItems: readonly BacklogSummaryView[]) => Effect.Effect<{ readonly watched: number; readonly released: number }>
    readonly refreshIssues: (openItems: readonly BacklogSummaryView[]) => Effect.Effect<void>
    readonly resolvePulls: (openItems: readonly BacklogSummaryView[]) => Effect.Effect<void, BacklogWriteFailed>
    readonly resolveIssues: (openItems: readonly BacklogSummaryView[]) => Effect.Effect<void, BacklogWriteFailed>
  }
>()('@dshfiles/backlog/ForgeLinks') {
  static readonly layer = Layer.effect(
    ForgeLinks,
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const pulls = yield* PullRequestState

      const syncWatches = Effect.fn('backlog forge watch sync')(function* (openItems: readonly BacklogSummaryView[]) {
        const current = yield* pulls.itemWatches
        if (current === null) return { watched: 0, released: 0 }
        const desired = new Map<number, { readonly urls: ReadonlySet<string>; readonly cwd: string | undefined }>()
        let budget = MAX_ITEM_WATCHES
        for (const item of [...openItems].sort((left, right) => right.id - left.id)) {
          const urls = pullRequestsOf(item).slice(0, Math.max(0, budget))
          if (urls.length === 0) continue
          budget -= urls.length
          desired.set(item.id, { urls: new Set(urls), cwd: item.project ?? undefined })
        }
        const held = new Set(current.map(watch => `${String(watch.itemId)} ${BacklogGates.pullRequestOf(watch.url)?.url ?? watch.url}`))
        const missing = [...desired].flatMap(([itemId, wanted]) =>
          [...wanted.urls].filter(url => !held.has(`${String(itemId)} ${url}`)).map(url => ({ itemId, url, cwd: wanted.cwd })),
        )
        const stale = current.filter(watch => {
          const url = BacklogGates.pullRequestOf(watch.url)?.url ?? watch.url
          return desired.get(watch.itemId)?.urls.has(url) !== true
        })
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.watch.missing': missing.length, 'dshx.backlog.watch.stale': stale.length })
        // One at a time: each new watch may poll its PR at once, and a burst would spend the forge's rate limit together.
        const watched = yield* Effect.forEach(missing, watch => pulls.watchForItem(watch), { concurrency: 1 })
        yield* Effect.forEach(stale, watch => pulls.releaseItem({ itemId: watch.itemId, url: watch.url }), { concurrency: 4, discard: true })
        return { watched: watched.filter(Boolean).length, released: stale.length }
      })

      const refreshIssues = Effect.fn('backlog forge issue refresh')(function* (openItems: readonly BacklogSummaryView[]) {
        yield* pulls.refreshIssues(openItems.flatMap(item => issueLinksOf(item).map(link => link.target)))
      })

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
        const closed = new Set<number>()
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each item resolves its own gates and links in order; the set dedupes them.
        for (const item of items) {
          const resolved = item.gates
            .filter(gate => gate.open && gate.kind === 'pr' && isMerged(gate.target))
            .map(gate => ({ gateId: gate.id, detail: 'merged' }))
          if (resolved.length > 0) yield* store.resolveGates({ id: item.id, resolved })
          for (const link of item.links.filter(candidate => candidate.type === 'url' && candidate.relation === 'fixes' && isMerged(candidate.target))) {
            yield* store.applySignal({ id: item.id, status: 'done', link, reason: `fixed by ${BacklogGates.label({ kind: 'pr', target: link.target })}` })
            closed.add(item.id)
          }
        }
        // A merged pull request closes the items its own description names, not only the one it is linked to.
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- resolvers are cheap local reads, run in ref order until a first miss.
        for (const closer of mergedPullRequestClosers(known.pullRequests)) {
          // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- one ref resolves at a time, skipping refs that already closed.
          for (const ref of closer.refs) {
            const id = yield* store.resolve(ref)
            if (id === undefined || closed.has(id)) continue
            const found = yield* store.get(id)
            if (!found.ok || found.value.item.status === 'done' || found.value.item.status === 'dropped') continue
            yield* store.applySignal({
              id,
              status: 'done',
              link: { type: 'url', target: closer.url, relation: 'fixes' },
              reason: `closed by ${BacklogGates.label({ kind: 'pr', target: closer.url })}`,
            })
            closed.add(id)
          }
        }
      })

      const resolveIssues = Effect.fn('backlog gate issues')(function* (items: readonly BacklogSummaryView[]) {
        const fixing = items.flatMap(item => issueLinksOf(item).flatMap(link => (link.relation === 'fixes' ? [{ item, link }] : [])))
        if (fixing.length === 0) return
        const states = new Map((yield* pulls.issues(fixing.map(entry => entry.link.target))).map(issue => [issue.url, issue]))
        for (const entry of fixing) {
          const issue = states.get(issueOf(entry.link.target)?.url ?? '')
          if (issue === undefined || issue.state !== 'closed' || (issue.reason !== null && unfinishedIssueReasons.has(issue.reason))) continue
          yield* store.applySignal({ id: entry.item.id, status: 'done', link: entry.link, reason: `fixed by ${issue.repo}#${String(issue.number)} closing` })
        }
      })

      return ForgeLinks.of({ syncWatches, refreshIssues, resolvePulls, resolveIssues })
    }),
  )
}
