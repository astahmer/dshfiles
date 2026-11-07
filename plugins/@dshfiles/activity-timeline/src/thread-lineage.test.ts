import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import type { AttentionItem } from './attention-api.js'
import { AttentionModel } from './attention-model.js'
import { ThreadLineageModel, type ThreadLineageHeader } from './thread-lineage.js'

const headersOf = (headers: Readonly<Record<string, ThreadLineageHeader | undefined>>) => (sessionId: string) => Effect.succeed(headers[sessionId])

const item = (id: string, sessionId: string, label?: string): AttentionItem =>
  AttentionModel.publish(
    undefined,
    {
      source: 'ai-accounts.quota-continuation',
      dedupeKey: id,
      subject: label === undefined ? { kind: 'session', id: sessionId } : { kind: 'session', id: sessionId, label },
      reason: 'Stopped by the usage limit.',
      severity: 'blocking',
      verbs: ['Resume', 'Open', 'Done'],
    },
    1_000,
  ).item

const run = <A>(effect: Effect.Effect<A>): A => Effect.runSync(effect)

describe('inbox thread lineage', () => {
  it('lists an item about a subagent under the parent thread', () => {
    const rootOf = (sessionId: string) =>
      ThreadLineageModel.rootOf({
        sessionId,
        headerOf: headersOf({ 'session-child': { origin: 'subagent', parentSessionId: 'session-parent' }, 'session-parent': {} }),
      })
    const [listed] = run(ThreadLineageModel.withParentSubjects({ items: [item('q', 'session-child', 'You are doing a narrow,')], rootOf }))
    expect(listed?.subject).toEqual({ kind: 'session', id: 'session-parent' })
  })

  it('walks to the top-level ancestor across nested subagents', () => {
    const headerOf = headersOf({
      'session-grandchild': { origin: 'subagent', parentSessionId: 'session-child' },
      'session-child': { origin: 'subagent', parentSessionId: 'session-parent' },
      'session-parent': {},
    })
    expect(run(ThreadLineageModel.rootOf({ sessionId: 'session-grandchild', headerOf }))).toBe('session-parent')
  })

  it('keeps a top-level thread, a fork and a side chat on their own subject', () => {
    const headerOf = headersOf({
      'session-parent': {},
      'session-fork': { parentSessionId: 'session-parent' },
      'session-chat': { parentSessionId: 'session-parent' },
    })
    const items = [item('a', 'session-parent'), item('b', 'session-fork'), item('c', 'session-chat')]
    const listed = run(ThreadLineageModel.withParentSubjects({ items, rootOf: sessionId => ThreadLineageModel.rootOf({ sessionId, headerOf }) }))
    expect(listed.map(entry => entry.subject)).toEqual(items.map(entry => entry.subject))
  })

  it('stops at the last session that exists when an ancestor is gone', () => {
    const headerOf = headersOf({ 'session-child': { origin: 'subagent', parentSessionId: 'session-missing' }, 'session-missing': undefined })
    expect(run(ThreadLineageModel.rootOf({ sessionId: 'session-child', headerOf }))).toBe('session-child')
  })

  it('leaves a subject alone when its own header cannot be read', () => {
    const headerOf = headersOf({})
    expect(run(ThreadLineageModel.rootOf({ sessionId: 'session-remote', headerOf }))).toBe('session-remote')
  })

  it('leaves a non-session subject untouched', () => {
    const backlogItem = AttentionModel.publish(
      undefined,
      {
        source: 'backlog.attention',
        dedupeKey: 'b1',
        subject: { kind: 'backlog-item', id: 'b:k3f9' },
        reason: 'A decision waits.',
        severity: 'blocking',
        verbs: ['Open', 'Done'],
      },
      1_000,
    ).item
    const listed = run(ThreadLineageModel.withParentSubjects({ items: [backlogItem], rootOf: () => Effect.succeed('session-parent') }))
    expect(listed).toEqual([backlogItem])
  })
})
