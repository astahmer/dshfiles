import { describe, expect, it } from 'vitest'
import {
  DONE_AFTER_IDLE_MS,
  DONE_GROUP_KEY,
  DONE_GROUP_OPEN_KEY,
  FINISHED_TURN_SOURCE,
  THREAD_STATUS_GROUPS,
  ThreadStatusModel,
  type ThreadStatusCopy,
  type ThreadStatusInput,
} from './thread-status.js'
import { threadSidebarDictionaries } from './locales.js'
import { workCountLabel } from '@dshfiles/plugin-ui/lib/work-count'

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

/** The English table's roll-up lines, as the client binds them with dshx's plural. */
const en = threadSidebarDictionaries.en
const pick = (one: string, other: string) => (count: number): string => (count === 1 ? one : other).replace('{count}', String(count))
const COPY: ThreadStatusCopy = {
  subagentsNeedYou: pick(en.threadSidebarSubagentsNeedYou_one, en.threadSidebarSubagentsNeedYou_other),
  subagentsFailed: pick(en.threadSidebarSubagentsFailed_one, en.threadSidebarSubagentsFailed_other),
  childrenWorking: counts => workCountLabel(counts, { working: pick(en.threadSidebarWorkingCount, en.threadSidebarWorkingCount), failed: pick(en.threadSidebarFailedCount, en.threadSidebarFailedCount) }),
}

describe('thread status', () => {
  it('maps the plain states', () => {
    expect(ThreadStatusModel.statusOf(input({ running: true })).status).toBe('working')
    expect(ThreadStatusModel.statusOf(input({ unread: true })).status).toBe('ready')
    expect(ThreadStatusModel.statusOf(input()).status).toBe('idle')
    expect(ThreadStatusModel.statusOf(input({ settled: true })).group).toBe('done')
    expect(ThreadStatusModel.statusOf(input({ archived: true, unread: true })).group).toBe('done')
  })

  it('shows a stopped turn or one that ran no step as Idle, not Ready', () => {
    for (const reason of ['aborted', 'blocked'] as const) {
      // The unacknowledged finish, its label and the finished-turn item an older Host still publishes as ready.
      const stopped = input({
        unread: true,
        labels: ['threadSidebarTurnFinished'],
        stoppedTurn: reason,
        inbox: { itemId: 'item-1', source: FINISHED_TURN_SOURCE, severity: 'ready', reason: 'Turn stopped before it finished.', verb: undefined, openedAt: NOW },
      })
      expect(ThreadStatusModel.statusOf(stopped).status).toBe('idle')
    }
    // Another provider's ready item (work to land) still makes it Ready, and so does work left unlanded.
    const toLand = input({
      unread: true,
      stoppedTurn: 'aborted',
      inbox: { itemId: 'item-2', source: 'jj-integration.land', severity: 'ready', reason: 'Ready to land', verb: 'Land', openedAt: NOW },
    })
    expect(ThreadStatusModel.statusOf(toLand)).toMatchObject({ status: 'ready', verb: 'Land' })
    expect(ThreadStatusModel.statusOf(input({ unread: true, stoppedTurn: 'aborted', unlanded: 2 })).status).toBe('ready')
    expect(ThreadStatusModel.statusOf(input({ unread: true })).status).toBe('ready')
    // A hand-made unread mark wins over the stopped finish it sits on.
    expect(ThreadStatusModel.stoppedTurnOf({ finishedReason: 'aborted', manuallyUnread: false })).toBe('aborted')
    expect(ThreadStatusModel.stoppedTurnOf({ finishedReason: 'blocked', manuallyUnread: true })).toBeUndefined()
    expect(ThreadStatusModel.stoppedTurnOf({ finishedReason: 'completed', manuallyUnread: false })).toBeUndefined()
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

  it('says what a Needs-you row asks without the Inbox lead-in: the glyph and verb say it (round five B4)', () => {
    const blocking = { itemId: 'i1', severity: 'blocking', verb: 'Answer', openedAt: NOW } as const
    const asks = ThreadStatusModel.statusOf(input({ inbox: { ...blocking, reason: 'Asks: Which rate should I use?' } }))
    expect(asks.detail).toBe('Which rate should I use?')
    const approve = ThreadStatusModel.statusOf(input({ inbox: { ...blocking, verb: 'Approve', reason: 'Approve: Publish the preview build' } }))
    expect(approve.detail).toBe('Publish the preview build')
    // A reason that only names its kind keeps it, and one without a lead-in is left as written.
    expect(ThreadStatusModel.statusOf(input({ inbox: { ...blocking, reason: 'Asks:' } })).detail).toBe('Asks:')
    expect(ThreadStatusModel.statusOf(input({ inbox: { ...blocking, reason: 'A question waits.' } })).detail).toBe('A question waits.')
  })

  it('puts failed threads in the Needs you group with a Retry from the inbox', () => {
    const status = ThreadStatusModel.statusOf(input({ inbox: { itemId: 'i2', severity: 'failed', reason: 'Turn failed.', verb: 'Retry', openedAt: NOW } }))
    expect(status).toMatchObject({ status: 'failed', group: 'needs-you', verb: 'Retry' })
  })

  it('keeps a thread Failed after its failed turn was read, until a later turn runs or the thread is done', () => {
    const failedTurn = { at: NOW - 30_000, reason: 'error' } as const
    // Read: no inbox item and no unread record are left, only the Host's record of the failed last turn.
    expect(ThreadStatusModel.statusOf(input({ failedTurn }))).toMatchObject({
      status: 'failed',
      group: 'needs-you',
      detail: 'Turn failed',
      since: NOW - 30_000,
    })
    expect(ThreadStatusModel.statusOf(input({ failedTurn: { at: NOW, reason: 'max-tokens' } })).detail).toBe('Stopped at the output limit')
    // Not something idle time folds away.
    expect(ThreadStatusModel.statusOf(input({ failedTurn, activityAt: NOW - DONE_AFTER_IDLE_MS - 1 })).status).toBe('failed')
    // A retry in flight is Working; marking the thread done ends it.
    expect(ThreadStatusModel.statusOf(input({ failedTurn, running: true })).status).toBe('working')
    expect(ThreadStatusModel.statusOf(input({ failedTurn, settled: true })).status).toBe('done')
    expect(ThreadStatusModel.statusOf(input({ failedTurn, archived: true })).status).toBe('done')
  })

  it('reads a subagent whose turn failed as Failed on its own row, and leaves it out of its parent\'s roll-up (round 21 D4)', () => {
    // The provider refused the child's turn: its finish is unread, so before this it read Ready.
    const failedTurn = { at: NOW - 5_000, reason: 'error' } as const
    const failed = ThreadStatusModel.childStatusOf(input({ unread: true, failedTurn }))
    expect(failed.row).toMatchObject({ status: 'failed', detail: 'Turn failed' })
    expect(failed.rollup.status).toBe('ready')
    // A child the user stopped keeps its own status: no failure, the two agree.
    const stopped = ThreadStatusModel.childStatusOf(input({ unread: true }))
    expect(stopped.row).toBe(stopped.rollup)
    expect(stopped.row.status).not.toBe('failed')
    // A working parent with a failed child stays Working.
    const parent = ThreadStatusModel.statusOf(input({ running: true }), [failed.rollup], COPY)
    expect(parent.status).toBe('working')
  })

  it('offers Review on a failed row whose provider names no verb, like a Needs-you row (council round 4 B4)', () => {
    const failedTurn = { at: NOW, reason: 'error' } as const
    expect(ThreadStatusModel.statusOf(input({ failedTurn })).verb).toBe('Review')
    const inbox = { itemId: 'i8', severity: 'failed', reason: 'failed', verb: undefined, openedAt: NOW, source: FINISHED_TURN_SOURCE } as const
    expect(ThreadStatusModel.statusOf(input({ inbox, failedTurn })).verb).toBe('Review')
    // A provider's own verb still wins.
    expect(ThreadStatusModel.statusOf(input({ inbox: { ...inbox, verb: 'Retry' } })).verb).toBe('Retry')
  })

  it('says why a failed turn failed instead of repeating the thread title', () => {
    const inbox = {
      itemId: 'i9',
      severity: 'failed',
      reason: '“Refactor pricing rounding” failed',
      verb: undefined,
      openedAt: NOW,
      source: FINISHED_TURN_SOURCE,
    } as const
    expect(ThreadStatusModel.statusOf(input({ inbox, failedTurn: { at: NOW, reason: 'error' } })).detail).toBe('Turn failed')
    // Another provider's failed item keeps its own reason.
    expect(
      ThreadStatusModel.statusOf(
        input({ inbox: { ...inbox, source: 'jj.conflict', reason: 'Conflict in src/a.ts' }, failedTurn: { at: NOW, reason: 'error' } }),
      ).detail,
    ).toBe('Conflict in src/a.ts')
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

  it('keeps a finished thread Ready while its workspace holds work that has not landed', () => {
    // Read, nothing pending, but 2 revisions wait in its own workspace: finished and not landed is Ready, not Idle.
    const waiting = ThreadStatusModel.statusOf(input({ unlanded: 2 }))
    expect(waiting).toMatchObject({ status: 'ready', group: 'ready', verb: undefined })
    // It does not fold into Done by age: landing is still to do.
    expect(ThreadStatusModel.statusOf(input({ unlanded: 1, activityAt: NOW - DONE_AFTER_IDLE_MS - 1 })).status).toBe('ready')
    // A running turn, a question or a failure still come first, and done is done.
    expect(ThreadStatusModel.statusOf(input({ unlanded: 1, running: true })).status).toBe('working')
    expect(ThreadStatusModel.statusOf(input({ unlanded: 1, labels: ['threadSidebarInputNeeded'] })).status).toBe('needs-you')
    expect(ThreadStatusModel.statusOf(input({ unlanded: 1, settled: true })).status).toBe('done')
    expect(ThreadStatusModel.statusOf(input({ unlanded: 0 })).status).toBe('idle')
  })

  it('rolls subagents up: a waiting or failed child lifts its parent, a running child keeps it Working', () => {
    const waitingChild = ThreadStatusModel.ownStatus(input({ labels: ['threadSidebarInputNeeded'] }))
    const failedChild = ThreadStatusModel.ownStatus(input({ inbox: { itemId: 'c', severity: 'failed', reason: 'x', verb: 'Retry', openedAt: NOW } }))
    const workingChild = ThreadStatusModel.ownStatus(input({ running: true }))
    expect(ThreadStatusModel.statusOf(input(), [waitingChild, waitingChild], COPY)).toMatchObject({ status: 'needs-you', detail: '2 subagents need you' })
    expect(ThreadStatusModel.statusOf(input({ running: true }), [failedChild], COPY)).toMatchObject({ status: 'failed', detail: '1 subagent failed', itemId: 'c' })
    expect(ThreadStatusModel.statusOf(input({ unread: true }), [workingChild], COPY)).toMatchObject({ status: 'working', detail: '1 working' })
    // The one count formula (council round 22, item 3): a child whose own turn failed is named, never lifted.
    expect(ThreadStatusModel.statusOf(input({ unread: true }), [workingChild, workingChild], COPY, 1)).toMatchObject({ status: 'working', detail: '2 working · 1 failed' })
    expect(ThreadStatusModel.statusOf(input({ running: true }), [workingChild], COPY, 2)).toMatchObject({ status: 'working', detail: '1 working · 2 failed' })
    // A parent that already needs you keeps its own reason.
    expect(ThreadStatusModel.statusOf(input({ labels: ['threadSidebarApprovalNeeded'] }), [failedChild]).verb).toBe('Approve')
  })

  it('groups in shell order and sorts by came-back time; Pinned keeps pin order', () => {
    const entry = (thread: string, overrides: Partial<ThreadStatusInput>, cameBackAt: number, pinnedIndex?: number) => {
      const base = { thread, status: ThreadStatusModel.statusOf(input(overrides)), cameBackAt }
      return pinnedIndex === undefined ? base : { ...base, pinnedIndex }
    }
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

  it('lists an unsent draft under Drafts, so the Idle count is threads only', () => {
    // The composer's open draft ("New thread") was counted as an idle thread: "Idle (2)" for one thread.
    const draft = ThreadStatusModel.statusOf(input({ draft: true }))
    expect(draft.group).toBe('draft')
    // It keeps the idle glyph: nothing runs and nothing waits.
    expect(draft.status).toBe('idle')
    expect(ThreadStatusModel.statusOf(input()).group).toBe('idle')
    const groups = ThreadStatusModel.groupEntries([
      { thread: 'sent', status: ThreadStatusModel.statusOf(input()), cameBackAt: 2 },
      { thread: 'unsent', status: draft, cameBackAt: 3 },
    ])
    expect(groups.map(group => [group.group, group.threads])).toEqual([
      ['idle', ['sent']],
      ['draft', ['unsent']],
    ])
    // Drafts sit after Idle and before the folded Done group.
    expect(THREAD_STATUS_GROUPS.indexOf('draft')).toBe(THREAD_STATUS_GROUPS.indexOf('idle') + 1)
  })
})

describe('group settler', () => {
  it('moves a row once its new group held for 600 ms, so a turn-end burst moves it once', () => {
    let clock = 0
    const settler = ThreadStatusModel.createGroupSettler(600, () => clock)
    expect(settler.groupOf('a', 'working')).toBe('working')
    // Working, Idle, Working, Ready within 300 ms: the row stays in Working.
    for (const [at, group] of [[100, 'idle'], [200, 'working'], [300, 'ready']] as const) {
      clock = at
      expect(settler.groupOf('a', group)).toBe('working')
    }
    expect(settler.wakeAt()).toBe(900)
    clock = 899
    expect(settler.groupOf('a', 'ready')).toBe('working')
    clock = 900
    expect(settler.groupOf('a', 'ready')).toBe('ready')
    expect(settler.wakeAt()).toBeUndefined()
  })

  it('seats a row it has not seen at once', () => {
    const settler = ThreadStatusModel.createGroupSettler(600, () => 0)
    expect(settler.groupOf('new', 'needs-you')).toBe('needs-you')
  })
})
