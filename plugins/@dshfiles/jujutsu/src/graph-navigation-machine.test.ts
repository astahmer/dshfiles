import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import type { GraphSlice, Revision, RevisionRelationship } from './api.js'
import { graphNavigationMachine, selectGraphNavigationViewState, type GraphNavigationClient } from './graph-navigation-machine.js'

const revision = (commitId: string, overrides: Partial<Revision> = {}): Revision => ({
  commitId,
  parents: [],
  changeId: commitId,
  shortestChangeId: commitId,
  description: commitId,
  author: 'Person',
  authorTime: '2026-10-15T12:00:00Z',
  bookmarks: [],
  localBookmarks: [],
  tags: [],
  workspaces: [],
  workingCopy: false,
  mine: true,
  immutable: false,
  divergent: false,
  empty: false,
  conflict: false,
  evolved: false,
  changeOffset: 0,
  ...overrides,
})

const graphSlice = (revisions: readonly Revision[], truncated = false): GraphSlice => ({
  operationId: 'a'.repeat(128),
  revisions: [...revisions],
  truncated,
})

const relationship = (overrides: Partial<RevisionRelationship> = {}): RevisionRelationship => ({
  operationId: 'b'.repeat(128),
  revisions: [revision('selected'), revision('target'), revision('shared')],
  truncated: true,
  commitId: 'selected',
  targetCommitId: 'target',
  relation: 'diverged',
  selectedOnlyCount: 1,
  targetOnlyCount: 1,
  commonAncestorIds: ['shared'],
  commonAncestorsTruncated: false,
  connectionIds: ['selected', 'target'],
  differenceIds: ['selected'],
  ...overrides,
})

const createGraphActor = (client: GraphNavigationClient) =>
  createActor(graphNavigationMachine, { input: { client, scope: 'root:repo', repoId: 'repo' } }).start()

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => {}
  const promise = new Promise<Value>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('graphNavigationMachine', () => {
  it('aborts old-scope slices and rejects late results after scope change', async () => {
    const pending = deferred<GraphSlice>()
    const signals: AbortSignal[] = []
    const actor = createGraphActor({
      graphSlice: (_request, options) => {
        signals.push(options.signal)
        return pending.promise
      },
    })

    actor.send({ type: 'slice.apply', revision: revision('old'), mode: 'history' })
    expect(actor.getSnapshot().matches('loading')).toBe(true)
    expect(signals).toHaveLength(1)
    const operationId = actor.getSnapshot().context.operationId

    actor.send({ type: 'scope.change', scope: 'root:next', repoId: 'next' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(signals[0]?.aborted).toBe(true)
    expect(actor.getSnapshot().context.scope).toBe('root:next')
    expect(actor.getSnapshot().context.operationId).toBeGreaterThan(operationId)

    pending.resolve(graphSlice([revision('old')]))
    await pending.promise
    await Promise.resolve()

    expect(actor.getSnapshot().context.view).toBeNull()
    expect(actor.getSnapshot().context.notice).toBe('')
    actor.stop()
  })

  it('hides previous-scope view state before the scope-change effect runs', async () => {
    const actor = createGraphActor({ graphSlice: async () => graphSlice([revision('old')]) })
    actor.send({ type: 'slice.apply', revision: revision('old'), mode: 'history' })
    await waitFor(actor, snapshot => snapshot.context.view !== null)

    const context = actor.getSnapshot().context
    expect(selectGraphNavigationViewState(context, 'root:next')).toEqual({
      view: null,
      hidden: [],
      revealed: [],
      lensSelection: null,
      notice: '',
    })
    expect(selectGraphNavigationViewState(context, 'root:repo').view).toEqual(context.view)
    actor.stop()
  })

  it('cancels without losing the applied view, while reset aborts and clears all view state', async () => {
    const pending = deferred<GraphSlice>()
    const signals: AbortSignal[] = []
    let callCount = 0
    const actor = createGraphActor({
      graphSlice: (_request, options) => {
        callCount += 1
        signals.push(options.signal)
        if (callCount === 1) return Promise.resolve(graphSlice([revision('base')]))
        if (callCount === 2) return Promise.resolve(graphSlice([revision('exclusive')]))
        return pending.promise
      },
    })

    actor.send({ type: 'slice.apply', revision: revision('base'), mode: 'history' })
    await waitFor(actor, snapshot => snapshot.context.view?.label === 'History leading to base')
    const appliedView = actor.getSnapshot().context.view

    actor.send({ type: 'slice.apply', revision: revision('hidden'), mode: 'exclusive' })
    await waitFor(actor, snapshot => snapshot.context.hidden.length === 1)
    actor.send({ type: 'revision.reveal', revision: revision('revealed') })
    actor.send({ type: 'relationship.highlight', commitId: 'selected', targetCommitId: 'target' })
    actor.send({ type: 'slice.apply', revision: revision('cancelled'), mode: 'history' })
    expect(actor.getSnapshot().matches('loading')).toBe(true)

    actor.send({ type: 'slice.cancel' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(signals[2]?.aborted).toBe(true)
    expect(actor.getSnapshot().context.view).toEqual(appliedView)
    expect(actor.getSnapshot().context.hidden).toHaveLength(1)

    actor.send({ type: 'slice.apply', revision: revision('reset'), mode: 'history' })
    expect(actor.getSnapshot().matches('loading')).toBe(true)
    actor.send({ type: 'reset' })

    expect(signals[3]?.aborted).toBe(true)
    expect(actor.getSnapshot().context.view).toBeNull()
    expect(actor.getSnapshot().context.hidden).toEqual([])
    expect(actor.getSnapshot().context.revealed).toEqual([])
    expect(actor.getSnapshot().context.lensSelection).toBeNull()
    expect(actor.getSnapshot().context.notice).toBe('')
    pending.resolve(graphSlice([revision('cancelled')]))
    await pending.promise
    await Promise.resolve()
    expect(actor.getSnapshot().context.view).toBeNull()
    actor.stop()
  })

  it('supersedes an in-flight slice and ignores its late completion', async () => {
    const first = deferred<GraphSlice>()
    const second = deferred<GraphSlice>()
    const signals: AbortSignal[] = []
    let callCount = 0
    const actor = createGraphActor({
      graphSlice: (_request, options) => {
        signals.push(options.signal)
        callCount += 1
        return callCount === 1 ? first.promise : second.promise
      },
    })

    actor.send({ type: 'slice.apply', revision: revision('first'), mode: 'history' })
    actor.send({ type: 'slice.apply', revision: revision('second'), mode: 'history' })
    expect(actor.getSnapshot().matches('loading')).toBe(true)
    expect(signals).toHaveLength(2)
    expect(signals[0]?.aborted).toBe(true)

    second.resolve(graphSlice([revision('second')]))
    await waitFor(actor, snapshot => snapshot.context.view?.label === 'History leading to second')
    first.resolve(graphSlice([revision('first')]))
    await first.promise
    await Promise.resolve()

    expect(actor.getSnapshot().context.view?.label).toBe('History leading to second')
    actor.stop()
  })

  it('reports a failed slice, preserves the prior view, and permits retry', async () => {
    let callCount = 0
    const actor = createGraphActor({
      graphSlice: async () => {
        callCount += 1
        if (callCount === 1) return graphSlice([revision('base')])
        if (callCount === 2) throw new Error('Graph read failed.')
        return graphSlice([revision('retry')])
      },
    })

    actor.send({ type: 'slice.apply', revision: revision('base'), mode: 'history' })
    await waitFor(actor, snapshot => snapshot.context.view?.label === 'History leading to base')
    const appliedView = actor.getSnapshot().context.view

    actor.send({ type: 'slice.apply', revision: revision('broken'), mode: 'history' })
    await waitFor(actor, snapshot => snapshot.context.notice === 'Graph read failed.')
    expect(actor.getSnapshot().context.view).toEqual(appliedView)

    actor.send({ type: 'slice.apply', revision: revision('retry'), mode: 'history' })
    await waitFor(actor, snapshot => snapshot.context.view?.label === 'History leading to retry')
    expect(actor.getSnapshot().context.notice).toBe('')
    actor.stop()
  })

  it('applies history and exclusive slices while preserving existing filters for empty results', async () => {
    let callCount = 0
    const actor = createGraphActor({
      graphSlice: async () => {
        callCount += 1
        if (callCount === 1) return graphSlice([revision('history'), revision('parent')], true)
        if (callCount === 2) return graphSlice([revision('exclusive')])
        return graphSlice([])
      },
    })

    actor.send({ type: 'slice.apply', revision: revision('history'), mode: 'history' })
    await waitFor(actor, snapshot => snapshot.context.view?.label === 'History leading to history')
    expect(actor.getSnapshot().context.view?.commitIds).toEqual(new Set(['history', 'parent']))
    expect(actor.getSnapshot().context.view?.truncated).toBe(true)

    actor.send({ type: 'slice.apply', revision: revision('exclusive'), mode: 'exclusive' })
    await waitFor(actor, snapshot => snapshot.context.hidden.length === 1)
    expect(actor.getSnapshot().context.hidden[0]?.commitIds).toEqual(['exclusive'])
    expect(actor.getSnapshot().context.view?.label).toBe('History leading to history')

    actor.send({ type: 'slice.apply', revision: revision('empty'), mode: 'exclusive' })
    await waitFor(actor, snapshot => snapshot.context.notice.startsWith('Nothing exclusive to hide:'))
    expect(actor.getSnapshot().context.hidden).toHaveLength(1)
    expect(actor.getSnapshot().context.view?.label).toBe('History leading to history')
    actor.stop()
  })

  it('applies Query relationships as derived views without issuing a slice request', () => {
    let sliceCalls = 0
    const actor = createGraphActor({
      graphSlice: async () => {
        sliceCalls += 1
        return graphSlice([])
      },
    })
    const result = relationship()

    actor.send({ type: 'relationship.highlight', commitId: result.commitId, targetCommitId: result.targetCommitId })
    expect(actor.getSnapshot().context.lensSelection).toEqual({ commitId: 'selected', targetCommitId: 'target' })
    expect(actor.getSnapshot().context.notice).toContain('Connection highlighted')

    actor.send({ type: 'relationship.apply', kind: 'difference', relationship: result, targetLabel: 'main' })
    expect(actor.getSnapshot().context.view).toEqual({
      kind: 'difference',
      label: 'Selected-only relative to main',
      commitIds: new Set(['selected']),
      revisions: result.revisions,
      truncated: true,
    })
    expect(actor.getSnapshot().context.lensSelection).toBeNull()

    actor.send({ type: 'relationship.apply', kind: 'connection', relationship: result, targetLabel: 'main' })
    expect(actor.getSnapshot().context.view?.commitIds).toEqual(new Set(['selected', 'target', 'shared']))
    expect(sliceCalls).toBe(0)
    actor.stop()
  })
})
