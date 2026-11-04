import { describe, expect, it } from 'vitest'
import { DONE_AFTER_IDLE_MS, DONE_GROUP_KEY, DONE_GROUP_OPEN_KEY, ThreadStatusModel, type ThreadStatusInput } from './thread-status.js'

const NOW = 10_000_000_000

const input = (overrides: Partial<ThreadStatusInput> = {}): ThreadStatusInput => ({
  running: false,
  pinned: false,
  archived: false,
  settled: false,
  unread: false,
  labels: [],
  inbox: undefined,
  activityAt: NOW - 60_000,
  settledAt: undefined,
  now: NOW,
  ...overrides,
})

describe('thread status', () => {
  it('maps the plain states', () => {
    expect(ThreadStatusModel.statusOf(input({ running: true })).status).toBe('working')
    expect(ThreadStatusModel.statusOf(input({ unread: true })).status).toBe('ready')
    expect(ThreadStatusModel.statusOf(input()).status).toBe('idle')
    expect(ThreadStatusModel.statusOf(input({ settled: true })).group).toBe('done')
    expect(ThreadStatusModel.statusOf(input({ archived: true, unread: true })).group).toBe('done')
  })

  it('folds a thread idle for 72 hours into Done, unless pinned', () => {
    const stale = input({ activityAt: NOW - DONE_AFTER_IDLE_MS - 1 })
    expect(ThreadStatusModel.statusOf(stale).group).toBe('done')
    const pinned = ThreadStatusModel.statusOf({ ...stale, pinned: true })
    expect(pinned.group).toBe('pinned')
    expect(pinned.status).toBe('done')
  })

  it('projects the inbox: a blocking item is Needs you with its verb and reason', () => {
    const status = ThreadStatusModel.statusOf(
      input({ running: true, inbox: { itemId: 'i1', severity: 'blocking', reason: 'A question waits.', verb: 'Answer', openedAt: NOW - 5 } }),
    )
    expect(status).toMatchObject({ status: 'needs-you', group: 'needs-you', verb: 'Answer', itemId: 'i1', detail: 'A question waits.', since: NOW - 5 })
  })

  it('puts failed threads in the Needs you group with a Retry from the inbox', () => {
    const status = ThreadStatusModel.statusOf(input({ inbox: { itemId: 'i2', severity: 'failed', reason: 'Turn failed.', verb: 'Retry', openedAt: NOW } }))
    expect(status).toMatchObject({ status: 'failed', group: 'needs-you', verb: 'Retry' })
  })

  it('uses the sidebar labels when the inbox is absent', () => {
    expect(ThreadStatusModel.statusOf(input({ labels: ['threadSidebarInputNeeded'] }))).toMatchObject({ status: 'needs-you', verb: 'Answer' })
    expect(ThreadStatusModel.statusOf(input({ labels: ['threadSidebarNeedsResume'] }))).toMatchObject({ status: 'needs-you', verb: 'Resume' })
    expect(ThreadStatusModel.statusOf(input({ labels: ['threadSidebarInterrupted'] }))).toMatchObject({ status: 'failed', verb: 'Resume' })
  })

  it('offers Land on a ready row only when the inbox names it', () => {
    expect(ThreadStatusModel.statusOf(input({ unread: true })).verb).toBeUndefined()
    const ready = ThreadStatusModel.statusOf(input({ inbox: { itemId: 'i3', severity: 'ready', reason: 'Ready to land.', verb: 'Land', openedAt: NOW } }))
    expect(ready).toMatchObject({ status: 'ready', verb: 'Land', itemId: 'i3' })
  })

  it('rolls subagents up: a waiting or failed child lifts its parent, a running child keeps it Working', () => {
    const waitingChild = ThreadStatusModel.ownStatus(input({ labels: ['threadSidebarInputNeeded'] }))
    const failedChild = ThreadStatusModel.ownStatus(input({ inbox: { itemId: 'c', severity: 'failed', reason: 'x', verb: 'Retry', openedAt: NOW } }))
    const workingChild = ThreadStatusModel.ownStatus(input({ running: true }))
    expect(ThreadStatusModel.statusOf(input(), [waitingChild, waitingChild])).toMatchObject({ status: 'needs-you', detail: '2 subagents need you' })
    expect(ThreadStatusModel.statusOf(input({ running: true }), [failedChild])).toMatchObject({ status: 'failed', detail: '1 subagent failed', itemId: 'c' })
    expect(ThreadStatusModel.statusOf(input({ unread: true }), [workingChild])).toMatchObject({ status: 'working', detail: 'waiting on 1 subagent' })
    // A parent that already needs you keeps its own reason.
    expect(ThreadStatusModel.statusOf(input({ labels: ['threadSidebarApprovalNeeded'] }), [failedChild]).verb).toBe('Approve')
  })

  it('groups in shell order and sorts by came-back time; Pinned keeps pin order', () => {
    const entry = (thread: string, overrides: Partial<ThreadStatusInput>, cameBackAt: number, pinnedIndex?: number) => ({
      thread,
      status: ThreadStatusModel.statusOf(input(overrides)),
      cameBackAt,
      ...(pinnedIndex === undefined ? {} : { pinnedIndex }),
    })
    const groups = ThreadStatusModel.groupEntries([
      entry('old-ready', { unread: true }, 1),
      entry('new-ready', { unread: true }, 2),
      entry('work', { running: true }, 5),
      entry('pin-b', { pinned: true }, 9, 1),
      entry('pin-a', { pinned: true }, 1, 0),
      entry('ask', { labels: ['threadSidebarInputNeeded'] }, 0),
    ])
    expect(groups.map(group => [group.group, group.threads])).toEqual([
      ['pinned', ['pin-a', 'pin-b']],
      ['needs-you', ['ask']],
      ['working', ['work']],
      ['ready', ['new-ready', 'old-ready']],
    ])
  })

  it('starts Done folded and stores its open marker when opened', () => {
    expect(ThreadStatusModel.isCollapsed(DONE_GROUP_KEY, [])).toBe(true)
    const opened = ThreadStatusModel.toggle(DONE_GROUP_KEY, [])
    expect(opened).toEqual([DONE_GROUP_OPEN_KEY])
    expect(ThreadStatusModel.isCollapsed(DONE_GROUP_KEY, opened)).toBe(false)
    expect(ThreadStatusModel.toggle(DONE_GROUP_KEY, opened)).toEqual([])
    expect(ThreadStatusModel.isCollapsed('state:ready', ThreadStatusModel.toggle('state:ready', []))).toBe(true)
  })

  it('records the moment a thread moves into another group', () => {
    const clock = ThreadStatusModel.createTransitionClock()
    expect(clock('s', 'idle', 100, 1_000)).toBe(100)
    expect(clock('s', 'idle', 120, 2_000)).toBe(120)
    expect(clock('s', 'needs-you', 150, 3_000)).toBe(3_000)
    expect(clock('s', 'needs-you', 150, 4_000)).toBe(3_000)
  })
})
