import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { ForgeLinks } from './forge-links.js'
import { BacklogGates } from './gates.js'
import { PullRequestState, type IssueView, type ItemWatch, type PullRequestLiveState } from './pull-request-state.js'
import { BacklogStore } from './store.js'
import { BacklogTestStore } from './test-support.js'

const user = { kind: 'user' } as const
const issueOf = BacklogGates.issueOf
const pullUrl = 'https://github.com/acme/widget/pull/7'
const issueUrl = 'https://github.com/acme/widget/issues/3'

/**
 * The pull-requests plugin as the backlog sees it through its contract: a PR's state is known only while something
 * watches it, and an issue's state only after a read. `forge` is what GitHub would answer.
 */
const pullRequestsPlugin = () => {
  const forge = { pulls: new Map<string, PullRequestLiveState>(), issues: new Map<string, { state: 'open' | 'closed'; reason: string | null }>() }
  let watches: ItemWatch[] = []
  const issueReads = new Map<string, IssueView>()
  const layer = Layer.succeed(
    PullRequestState,
    PullRequestState.of({
      available: Effect.succeed(true),
      of: urls =>
        Effect.sync(() => ({
          available: true,
          pullRequests: urls.flatMap(url => {
            const pull = BacklogGates.pullRequestOf(url)
            if (pull === null) return []
            const watched = watches.some(watch => watch.url === pull.url)
            return [
              {
                url: pull.url,
                repo: pull.repo,
                number: pull.number,
                state: watched ? (forge.pulls.get(pull.url) ?? 'open') : ('unknown' as const),
                checks: 'none' as const,
                watched,
                body: null,
                checkedAt: watched ? 1 : null,
              },
            ]
          }),
        })),
      watch: () => Effect.succeed(false),
      watchForItem: input =>
        Effect.sync(() => {
          watches = [...watches, { itemId: input.itemId, url: input.url }]
          return true
        }),
      releaseItem: input =>
        Effect.sync(() => {
          watches = watches.filter(watch => watch.itemId !== input.itemId || (input.url !== undefined && watch.url !== input.url))
        }),
      itemWatches: Effect.sync(() => watches),
      issues: urls =>
        Effect.sync(() =>
          urls.flatMap(url => {
            const issue = issueOf(url)
            return issue === null ? [] : [issueReads.get(issue.url) ?? { ...issue, state: 'unknown' as const, reason: null, checkedAt: null }]
          }),
        ),
      refreshIssues: urls =>
        Effect.sync(() => {
          for (const url of urls) {
            const issue = issueOf(url)
            const answer = issue === null ? undefined : forge.issues.get(issue.url)
            if (issue !== null && answer !== undefined) issueReads.set(issue.url, { ...issue, ...answer, checkedAt: 2 })
          }
        }),
    }),
  )
  return { forge, layer, watches: () => watches }
}

const open = (plugin: ReturnType<typeof pullRequestsPlugin>) =>
  Effect.map(Layer.build(ForgeLinks.layer.pipe(Layer.provideMerge(Layer.mergeAll(BacklogTestStore.layer(), plugin.layer)))), context => ({
    store: Context.get(context, BacklogStore),
    forge: Context.get(context, ForgeLinks),
  }))

const openItems = (store: BacklogStore['Service']) =>
  Effect.map(store.list({ freshness: 'all', statuses: ['inbox', 'todo', 'doing'], limit: 100 }), listed => listed.items)

describe('forge links', () => {
  it.effect('an item linked to a pull request with no thread watches it and closes when it merges', () =>
    Effect.gen(function* () {
      const plugin = pullRequestsPlugin()
      const { store, forge } = yield* open(plugin)
      const item = (yield* store.capture({ text: 'Ship sprockets', actor: user })).item
      yield* store.link({ id: item.id, link: { type: 'url', target: pullUrl, relation: 'fixes' }, actor: user })
      plugin.forge.pulls.set(pullUrl, 'merged')

      // Without an item watch nothing polls the PR, so the merge is never seen: the item stayed open forever.
      yield* forge.resolvePulls(yield* openItems(store))
      expect(yield* store.get(item.id)).toMatchObject({ ok: true, value: { item: { status: 'inbox' } } })

      expect(yield* forge.syncWatches(yield* openItems(store))).toEqual({ watched: 1, released: 0 })
      expect(plugin.watches()).toEqual([{ itemId: item.id, url: pullUrl }])
      yield* forge.resolvePulls(yield* openItems(store))
      expect(yield* store.get(item.id)).toMatchObject({ ok: true, value: { item: { status: 'done' } } })
    }),
  )

  it.effect('watches every linked PR whatever its relation, and releases the watch once the item is done', () =>
    Effect.gen(function* () {
      const plugin = pullRequestsPlugin()
      const { store, forge } = yield* open(plugin)
      const item = (yield* store.capture({ text: 'Review the widget PR', actor: user })).item
      yield* store.link({ id: item.id, link: { type: 'url', target: `${pullUrl}/files`, relation: 'implements' }, actor: user })

      yield* forge.syncWatches(yield* openItems(store))
      expect(plugin.watches()).toEqual([{ itemId: item.id, url: pullUrl }])
      expect(yield* forge.syncWatches(yield* openItems(store))).toEqual({ watched: 0, released: 0 })

      plugin.forge.pulls.set(pullUrl, 'merged')
      yield* forge.resolvePulls(yield* openItems(store))
      expect(yield* store.get(item.id)).toMatchObject({ ok: true, value: { item: { status: 'inbox' } } })

      yield* store.update({ id: item.id, status: 'done', actor: user })
      expect(yield* forge.syncWatches(yield* openItems(store))).toEqual({ watched: 0, released: 1 })
      expect(plugin.watches()).toEqual([])
    }),
  )

  it.effect('a fixes issue closed as completed closes its item; not planned or a status set by hand does not', () =>
    Effect.gen(function* () {
      const plugin = pullRequestsPlugin()
      const { store, forge } = yield* open(plugin)
      const fixed = (yield* store.capture({ text: 'Fix the crash', actor: user })).item
      const declined = (yield* store.capture({ text: 'Add dark mode', actor: user })).item
      const held = (yield* store.capture({ text: 'Keep this open', actor: user })).item
      const declinedUrl = 'https://github.com/acme/widget/issues/4'
      const heldUrl = 'https://github.com/acme/widget/issues/5'
      yield* store.link({ id: fixed.id, link: { type: 'url', target: issueUrl, relation: 'fixes' }, actor: user })
      yield* store.link({ id: declined.id, link: { type: 'url', target: declinedUrl, relation: 'fixes' }, actor: user })
      yield* store.link({ id: held.id, link: { type: 'url', target: heldUrl, relation: 'fixes' }, actor: user })
      yield* store.update({ id: held.id, status: 'todo', actor: user })
      plugin.forge.issues.set(issueUrl, { state: 'open', reason: null })

      yield* forge.refreshIssues(yield* openItems(store))
      yield* forge.resolveIssues(yield* openItems(store))
      expect(yield* store.get(fixed.id)).toMatchObject({ ok: true, value: { item: { status: 'inbox' } } })

      plugin.forge.issues.set(issueUrl, { state: 'closed', reason: 'COMPLETED' })
      plugin.forge.issues.set(declinedUrl, { state: 'closed', reason: 'NOT_PLANNED' })
      plugin.forge.issues.set(heldUrl, { state: 'closed', reason: 'COMPLETED' })
      yield* forge.refreshIssues(yield* openItems(store))
      yield* forge.resolveIssues(yield* openItems(store))
      expect(yield* store.get(fixed.id)).toMatchObject({ ok: true, value: { item: { status: 'done' } } })
      expect(yield* store.get(declined.id)).toMatchObject({ ok: true, value: { item: { status: 'inbox' } } })
      expect(yield* store.get(held.id)).toMatchObject({ ok: true, value: { item: { status: 'todo' } } })
    }),
  )
})
