import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityTimeline, activityTimelineEnqueue, activityTimelineEvent, activityTimelinePage } from './activity-timeline-effect.js'
import type { ActivityIngest } from './types.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('activity timeline Effect service', () => {
  it('runs the real timeline through its scoped Layer and flushes on release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'activity-timeline-effect-'))
    temporaryRoots.push(root)
    const event: ActivityIngest = {
      id: 'effect-event',
      at: 1_800_000_000_000,
      source: 'communication',
      type: 'communication.activity',
      summary: 'Effect-backed event',
      metadata: {},
      references: [],
      provenance: 'observed',
    }
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const ingested = yield* activityTimelineEnqueue(event)
          const page = yield* activityTimelinePage({ detailed: true })
          return { ingested, page }
        }),
        ActivityTimeline.layer({ statePath: join(root, 'state.json') }),
      ),
    )
    expect(result.ingested.duplicate).toBe(false)
    expect(result.page.items.map(item => item.id)).toEqual(['effect-event'])
    await expect(
      Effect.runPromise(Effect.provide(activityTimelineEvent('missing'), ActivityTimeline.layer({ statePath: join(root, 'state.json') }))),
    ).rejects.toMatchObject({ _tag: 'ActivityTimelineFailure', code: 'event-not-found' })
  })
})
