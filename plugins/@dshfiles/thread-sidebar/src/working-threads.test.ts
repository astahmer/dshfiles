import { describe, expect, it } from 'vitest'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { workingThreadIds, WorkingThreadsProjection } from './working-threads.js'

describe('working thread view', () => {
  it('includes threads whose own turn runs and parents whose subagent runs', () => {
    expect(
      workingThreadIds([
        { session: { id: 'idle', running: false }, activity: { running: false } },
        { session: { id: 'running', running: true }, activity: { running: true } },
        { session: { id: 'parent-with-running-child', running: false }, activity: { running: true } },
      ]),
    ).toEqual(new Set(['running', 'parent-with-running-child']))
  })
})

describe('the working projection every count reads', () => {
  const threads = [
    { session: { id: 'held', running: true }, activity: { running: true } },
    { session: { id: 'asks-you', running: true }, activity: { running: true } },
    { session: { id: 'parent-with-running-child', running: false }, activity: { running: true } },
    { session: { id: 'idle', running: false }, activity: { running: false } },
  ]

  it('follows the status vocabulary: a thread that waits for your answer runs a turn but is not Working', () => {
    const status = new Map<string, WorkStatus>([
      ['held', 'working'],
      ['asks-you', 'needs-you'],
      ['parent-with-running-child', 'working'],
      ['idle', 'idle'],
    ])
    expect(WorkingThreadsProjection.ids(threads, { statusOf: id => status.get(id), waiting: new Set() })).toEqual(
      new Set(['held', 'parent-with-running-child']),
    )
  })

  it('without row statuses (manual arrangement) leaves out the threads known to wait for you', () => {
    expect(WorkingThreadsProjection.ids(threads, { statusOf: () => undefined, waiting: new Set(['asks-you']) })).toEqual(
      new Set(['held', 'parent-with-running-child']),
    )
  })

  it('publishes one count and tells its readers', () => {
    const seen: (number | null)[] = []
    const stop = WorkingThreadsProjection.subscribe(() => seen.push(WorkingThreadsProjection.count()))
    WorkingThreadsProjection.publish(2)
    WorkingThreadsProjection.publish(2)
    WorkingThreadsProjection.publish(null)
    stop()
    expect(seen).toEqual([2, null])
  })
})
