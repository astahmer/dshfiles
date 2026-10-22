import { describe, expect, it } from 'vitest'
import type { ThreadRevisionView, ThreadView } from './api.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'
import type { IntegrationJobPhase } from './integration-queue-machine.js'

const revision = (overrides: Partial<ThreadRevisionView> = {}): ThreadRevisionView => ({
  changeId: 'change-id',
  commitId: 'commit-id',
  description: 'feat: add feature',
  conflict: false,
  ...overrides,
})

const createThread = (overrides: Partial<ThreadView> = {}): ThreadView => ({
  name: 'thread-abcdef',
  path: '/repo-threads/thread-abcdef',
  workspaceId: 'workspace-id',
  sessionIds: [],
  finished: false,
  canRebase: true,
  missing: false,
  behind: false,
  behindCount: 0,
  unlanded: [revision()],
  ...overrides,
})

const assess = (input: {
  readonly thread?: Partial<ThreadView>
  readonly running?: boolean
  readonly waitingForInput?: boolean
  readonly integrationAllowed?: boolean | undefined
  readonly jobPhase?: IntegrationJobPhase | undefined
}) =>
  ThreadIntegrationModel.assess({
    thread: createThread(input.thread),
    running: input.running ?? false,
    waitingForInput: input.waitingForInput ?? false,
    integrationAllowed: 'integrationAllowed' in input ? input.integrationAllowed : true,
    jobPhase: input.jobPhase,
  })

describe('thread integration assessment', () => {
  it('offers integration only for described, conflict-free pending work with a verified idle thread', () => {
    const ready = assess({})
    expect(ready.category).toBe('ready')
    expect(ready.blockers).toEqual([])
    expect(ready.needsAttention).toBe(true)
    expect(ThreadIntegrationModel.canSelectForIntegration(ready)).toBe(true)
    expect(assess({ integrationAllowed: false }).category).toBe('blocked')
    expect(assess({ integrationAllowed: undefined }).category).toBe('unknown')
    expect(assess({ thread: { unlanded: [revision({ description: 'WIP' })] } }).blockers).toEqual(['description'])
    expect(assess({ thread: { unlanded: [revision({ description: '' })] } }).blockers).toEqual(['description'])
  })

  it('treats a workspace that only sits behind the bookmark as no changes, never as a blocker', () => {
    const behind = assess({ thread: { unlanded: [], behind: true, behindCount: 13 } })
    expect(behind.category).toBe('no-changes')
    expect(behind.blockers).toEqual([])
    expect(behind.needsAttention).toBe(false)
    expect(behind.behindBookmark).toBe(13)
    expect(ThreadIntegrationModel.canSelectForIntegration(behind)).toBe(false)
    expect(assess({ thread: { unlanded: [], behind: false } }).category).toBe('no-changes')
  })

  it('keeps pending work ready while the base is behind the bookmark', () => {
    const pending = assess({ thread: { behind: true, behindCount: 4 } })
    expect(pending.category).toBe('ready')
    expect(pending.pendingRevisions).toBe(1)
    expect(pending.behindBookmark).toBe(4)
  })

  it('classifies already integrated work as integrated, not as pending or blocked', () => {
    const integrated = assess({ thread: { unlanded: [], rebasedAt: Date.now(), behind: true, behindCount: 2 } })
    expect(integrated.category).toBe('integrated')
    expect(integrated.needsAttention).toBe(false)
  })

  it('blocks pending work on the specific reason, hardest first', () => {
    expect(assess({ running: true }).blockers).toEqual(['active'])
    expect(assess({ waitingForInput: true }).blockers).toEqual(['question'])
    expect(assess({ integrationAllowed: false }).blockers).toEqual(['active'])
    expect(assess({ integrationAllowed: undefined }).category).toBe('unknown')
    expect(assess({ integrationAllowed: undefined }).blockers).toEqual(['activity-unknown'])
  })

  it('reports a confirmed conflict over any other pending blocker', () => {
    const conflicted = assess({
      thread: { unlanded: [revision({ conflict: true, description: 'wip' })] },
      running: true,
      integrationAllowed: false,
    })
    expect(conflicted.category).toBe('conflicts')
    expect(conflicted.blocker).toBe('conflict')
    expect(conflicted.blockers).toEqual(['conflict', 'active', 'description'])
    expect(conflicted.conflictedRevisions).toBe(1)
  })

  it('shows every blocker while the failing one stays primary', () => {
    const multiple = assess({ waitingForInput: true, running: true, thread: { unlanded: [revision({ description: '' })] } })
    expect(multiple.blockers).toEqual(['question', 'active', 'description'])
    expect(multiple.blocker).toBe('question')
    expect(multiple.category).toBe('blocked')
    expect(multiple.pendingRevisions).toBe(1)
    expect(multiple.undescribedRevisions).toBe(1)
  })

  it('never calls an inaccessible workspace safe to integrate', () => {
    const missing = assess({ thread: { missing: true } })
    expect(missing.category).toBe('unknown')
    expect(missing.blocker).toBe('missing')
    expect(ThreadIntegrationModel.canSelectForIntegration(missing)).toBe(false)
    const missingWithoutWork = assess({ thread: { missing: true, unlanded: [] } })
    expect(missingWithoutWork.category).toBe('unknown')
    expect(missingWithoutWork.needsAttention).toBe(true)
  })

  it('keeps a finished thread with valid pending work ready to integrate', () => {
    const finished = assess({ thread: { finished: true } })
    expect(finished.category).toBe('ready')
    expect(ThreadIntegrationModel.canSelectForIntegration(finished)).toBe(true)
  })

  it('follows the queued, running, failed and completed operation phases', () => {
    for (const phase of ['queued', 'validating', 'rebasing', 'integrating'] as const) expect(assess({ jobPhase: phase }).category).toBe('integrating')
    expect(assess({ jobPhase: 'failed' }).category).toBe('blocked')
    expect(assess({ jobPhase: 'needs-description' }).category).toBe('blocked')
    expect(assess({ jobPhase: 'conflicts' }).category).toBe('conflicts')
    expect(assess({ jobPhase: 'integrated' }).category).toBe('integrated')
    expect(assess({ jobPhase: 'up-to-date' }).category).toBe('no-changes')
    expect(assess({ jobPhase: 'queued', thread: { unlanded: [], rebasedAt: Date.now() } }).category).toBe('integrating')
  })

  it('counts a workspace as finished only when every conversation is archived', () => {
    expect(ThreadIntegrationModel.isFinishedThread([], new Set())).toBe(false)
    expect(ThreadIntegrationModel.isFinishedThread(['session-a'], new Set())).toBe(false)
    expect(ThreadIntegrationModel.isFinishedThread(['session-a', 'session-b'], new Set(['session-a']))).toBe(false)
    expect(ThreadIntegrationModel.isFinishedThread(['session-a', 'session-b'], new Set(['session-a', 'session-b']))).toBe(true)
  })

  it('lets a blank New-thread slot keep an archived thread finished', () => {
    const archived = new Set(['session-real'])
    expect(ThreadIntegrationModel.isFinishedThread(['session-blank', 'session-real'], archived, new Set(['session-blank']))).toBe(true)
    expect(ThreadIntegrationModel.isFinishedThread(['session-blank', 'session-real'], archived, new Set())).toBe(false)
    expect(ThreadIntegrationModel.isFinishedThread(['session-blank'], new Set(), new Set(['session-blank']))).toBe(false)
  })

  it('falls back to the coarse behind flag when a Host predates behindCount', () => {
    const legacy = assess({ thread: { unlanded: [], behind: true, behindCount: undefined } })
    expect(legacy.behindBookmark).toBe(1)
    expect(legacy.category).toBe('no-changes')
  })
})
