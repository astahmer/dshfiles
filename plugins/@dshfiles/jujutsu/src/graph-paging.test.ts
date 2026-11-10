import assert from 'node:assert/strict'
import { test } from 'vitest'
import { GraphPagingModel } from './graph-paging.js'

const viewport = { scrollTop: 0, scrollHeight: 2400, clientHeight: 900 }
const deepHistory = { scrollTop: 0, scrollHeight: 40_000, clientHeight: 900 }

test('names a page set by its repository, search and snapshot, so a changed one starts a new query', () => {
  const current = { repoId: 'repo', query: '', generation: 'manual:refreshed-at-2' }
  assert.notEqual(GraphPagingModel.pageSetScope(current), GraphPagingModel.pageSetScope({ ...current, generation: 'manual:refreshed-at-1' }))
  assert.notEqual(GraphPagingModel.pageSetScope(current), GraphPagingModel.pageSetScope({ ...current, repoId: 'other' }))
  assert.notEqual(GraphPagingModel.pageSetScope(current), GraphPagingModel.pageSetScope({ ...current, query: 'wip' }))
  assert.equal(GraphPagingModel.pageSetScope(current), GraphPagingModel.pageSetScope({ ...current }))
})

test('the first page excludes the repository read outside a search, and nothing inside one', () => {
  assert.deepEqual(GraphPagingModel.firstPageExclude({ query: 'wip', baseCommitIds: ['a'] }), [])
  assert.deepEqual(GraphPagingModel.firstPageExclude({ query: '', baseCommitIds: ['a', 'b'] }), ['a', 'b'])
})

test('each next page excludes everything already loaded, so pages concatenate without duplicates', () => {
  const first = GraphPagingModel.nextPageExclude({ hasMore: true, addedCommitIds: ['a', 'b'], excludeCommitIds: [] })
  assert.deepEqual(first, ['a', 'b'])
  assert.ok(first !== undefined)
  const second = GraphPagingModel.nextPageExclude({ hasMore: true, addedCommitIds: ['c'], excludeCommitIds: first })
  assert.deepEqual(second, ['a', 'b', 'c'])
  assert.ok(second !== undefined)
  // A page that added nothing would ask for itself again; the chain ends there whatever the Host reports.
  assert.equal(GraphPagingModel.nextPageExclude({ hasMore: true, addedCommitIds: [], excludeCommitIds: second }), undefined)
  assert.equal(GraphPagingModel.nextPageExclude({ hasMore: false, addedCommitIds: ['d'], excludeCommitIds: [] }), undefined)
})

test('keeps two viewports of loaded history below the viewport, with a floor for a short list', () => {
  assert.equal(GraphPagingModel.lookahead(900), 1800)
  assert.equal(GraphPagingModel.lookahead(200), 1200)
  assert.equal(GraphPagingModel.lookahead(0), 1200)
})

test('requests pages two viewports ahead, near the end, or when nothing fills the viewport', () => {
  assert.equal(GraphPagingModel.needsAnotherPage(viewport), true)
  assert.equal(GraphPagingModel.needsAnotherPage(deepHistory), false)
  assert.equal(GraphPagingModel.needsAnotherPage({ scrollTop: 31_100, scrollHeight: 40_000, clientHeight: 900 }), false)
  assert.equal(GraphPagingModel.needsAnotherPage({ scrollTop: 37_300, scrollHeight: 40_000, clientHeight: 900 }), true)
  assert.equal(GraphPagingModel.needsAnotherPage({ scrollTop: 38_000, scrollHeight: 40_000, clientHeight: 900 }), true)
  assert.equal(GraphPagingModel.needsAnotherPage({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), true)
})

test('tops itself up to forty revisions without a scroll event, even when one page already covers the viewport', () => {
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionFloor - 1, ...deepHistory }), true)
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionFloor, ...deepHistory }), false)
})

test('stops loading when more than two viewport heights remain below the viewport', () => {
  assert.equal(
    GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionFloor, scrollTop: 0, scrollHeight: 2800, clientHeight: 900 }),
    false,
  )
})

test('keeps loading while the loaded history leaves less than the lookahead below the viewport, then stops at the chain limit', () => {
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionFloor, ...viewport }), true)
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionLimit - 1, ...viewport }), true)
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionLimit, ...viewport }), false)
  // Scrolling past the limit still loads: the chain limit only bounds the automatic top-up.
  assert.equal(GraphPagingModel.needsAnotherPage(viewport), true)
})

test('keeps loaded older pages across a refresh that read the same repository', async () => {
  const { QueryClient } = await import('@dshfiles/plugin-ui/query')
  const client = new QueryClient()
  const read = () => ({ revisions: [{ commitId: 'a'.repeat(40) }], status: 'clean' })
  const first = await client.fetchQuery({ queryKey: ['state'], queryFn: read })
  const start = GraphPagingModel.snapshotGeneration({ state: undefined, generation: 0 }, first)
  await client.refetchQueries({ queryKey: ['state'] })
  const unchanged = GraphPagingModel.snapshotGeneration(start, client.getQueryData(['state']))
  assert.equal(unchanged, start)

  const changed = { revisions: [{ commitId: 'b'.repeat(40) }], status: 'clean' }
  const next = GraphPagingModel.snapshotGeneration(unchanged, changed)
  assert.equal(next.generation, start.generation + 1)
  assert.equal(next.state, changed)
})
