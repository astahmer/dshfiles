import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ActivityTimelineAdapters } from './adapters.js'
import { ActivityTimeline } from './activity-timeline.js'
import { now, temporaryStatePath, timelineLayer } from './test-support.js'
import type { ActivityIngest } from './types.js'

const withTimeline = <A, E>(body: Effect.Effect<A, E, ActivityTimeline>) =>
  Effect.flatMap(temporaryStatePath, statePath => body.pipe(Effect.provide(timelineLayer({ statePath }))))

const cleanupFailure = (input: { readonly sessionId: string; readonly workspaceId: string; readonly workspaceName: string }): ActivityIngest =>
  ActivityTimelineAdapters.workspaceActivity({
    id: 'workspace:cleanup-failed',
    at: now,
    type: 'workspace.cleanup-failed',
    level: 'attention',
    summary: 'Automatic thread-workspace cleanup failed',
    detail: 'boom',
    ...input,
  })

describe('workspace activity without a workspace', () => {
  it.effect('stores the reported cleanup failure even though it names no workspace', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const [stored] = yield* timeline.ingest([cleanupFailure({ sessionId: '', workspaceId: '', workspaceName: '' })])
        expect(stored?.duplicate).toBe(false)
        expect((yield* timeline.page({ detailed: true })).items[0]?.references).toEqual([])
      }),
    ),
  )

  it.effect('drops a blank reference instead of failing the whole event', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const [stored] = yield* timeline.ingest([cleanupFailure({ sessionId: '', workspaceId: 'workspace-1', workspaceName: 'thread-a' })])
        expect(stored?.duplicate).toBe(false)
        expect((yield* timeline.page({ detailed: true })).items[0]?.references).toEqual([{ kind: 'workspace', id: 'workspace-1', label: 'thread-a' }])
      }),
    ),
  )

  it.effect('stores session activity without an invalid blank session reference', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const [stored] = yield* timeline.ingest([ActivityTimelineAdapters.sessionActivity({ kind: 'created', at: now, sessionId: '' })])
        expect(stored?.duplicate).toBe(false)
        expect((yield* timeline.page({ detailed: true })).items[0]).toMatchObject({ sessionId: null, references: [] })
      }),
    ),
  )

  it.effect('fails a malformed enqueued event with a typed error instead of storing it', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const malformed: ActivityIngest = {
          ...cleanupFailure({ sessionId: '', workspaceId: 'workspace-1', workspaceName: 'thread-a' }),
          references: [{ kind: 'workspace', id: '', label: null }],
        }
        expect((yield* Effect.flip(timeline.enqueue(malformed)))._tag).toBe('ActivityIngestInvalid')
        expect((yield* timeline.stats).retained).toBe(0)
      }),
    ),
  )
})
