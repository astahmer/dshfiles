import { describe, expect, it } from 'vitest'
import type { ThreadRevisionView, ThreadView } from './api.js'
import { InlineIntegrateOffer } from './inline-integrate.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'

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
  sessionIds: ['session-1'],
  finished: false,
  canRebase: true,
  missing: false,
  behind: false,
  behindCount: 0,
  unlanded: [revision()],
  ...overrides,
})

const offer = (input: {
  readonly thread?: Partial<ThreadView>
  readonly running?: boolean
  readonly waitingForInput?: boolean
  readonly integrationAllowed?: boolean | undefined
  readonly isNewestTurn?: boolean
  readonly archived?: boolean
  readonly landing?: boolean
  readonly queued?: boolean
  readonly statusRefreshing?: boolean
}) =>
  InlineIntegrateOffer.isOffered({
    category: ThreadIntegrationModel.assess({
      thread: createThread(input.thread),
      running: input.running ?? false,
      waitingForInput: input.waitingForInput ?? false,
      integrationAllowed: 'integrationAllowed' in input ? input.integrationAllowed : true,
    }).category,
    isNewestTurn: input.isNewestTurn ?? true,
    archived: input.archived ?? false,
    landing: input.landing ?? false,
    queued: input.queued ?? false,
    statusRefreshing: input.statusRefreshing ?? false,
  })

describe('inline integration offer', () => {
  it('offers one click for a finished turn whose described work is ready', () => {
    expect(offer({})).toBe(true)
    expect(offer({ thread: { unlanded: [revision(), revision({ changeId: 'second-change' })] } })).toBe(true)
  })

  it('never offers while the thread is still writing, asking, or unverified', () => {
    expect(offer({ running: true })).toBe(false)
    expect(offer({ waitingForInput: true })).toBe(false)
    expect(offer({ integrationAllowed: false })).toBe(false)
    expect(offer({ integrationAllowed: undefined })).toBe(false)
  })

  it('never offers work that would only be refused: undescribed, conflicted, or already landed', () => {
    expect(offer({ thread: { unlanded: [revision({ description: 'wip' })] } })).toBe(false)
    expect(offer({ thread: { unlanded: [revision({ conflict: true })] } })).toBe(false)
    expect(offer({ thread: { unlanded: [] } })).toBe(false)
    expect(offer({ thread: { unlanded: [], rebasedAt: 1, rebasedTipChangeId: 'tip' } })).toBe(false)
  })

  it('keeps the offer on the newest turn only, and never on an archived, landing, queued, or refreshing thread', () => {
    expect(offer({ isNewestTurn: false })).toBe(false)
    expect(offer({ archived: true })).toBe(false)
    expect(offer({ landing: true })).toBe(false)
    expect(offer({ queued: true })).toBe(false)
    expect(offer({ statusRefreshing: true })).toBe(false)
  })
})
