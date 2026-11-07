import { describe, expect, it } from 'vitest'
import { ResumeAttentionModel } from './resume-attention.js'
import type { QuotaContinuation } from './usage-limit-rows.js'
import type { InboxThreadSignal, ThreadStatus } from './thread-status.js'

const signal = (patch: Partial<InboxThreadSignal> = {}): InboxThreadSignal => ({
  itemId: 'item-1',
  severity: 'blocking',
  reason: 'Stopped by the usage limit.',
  verb: 'Resume',
  openedAt: 1,
  ...patch,
})

const status = (patch: Partial<ThreadStatus> = {}): ThreadStatus => ({
  status: 'needs-you',
  group: 'needs-you',
  detail: undefined,
  verb: 'Resume',
  itemId: undefined,
  since: 1,
  ...patch,
})

const continuation: QuotaContinuation = {
  continuationId: 'continuation-1',
  sessionId: 'session-1',
  accountId: 'codex_work',
  failedAt: 1,
  resetAt: null,
  autoRetry: false,
  snoozedUntil: null,
  state: 'waiting',
  scheduled: false,
  ready: false,
}

describe('resume attention targets', () => {
  it('runs the inbox verb when the provider offers Resume, the way the Inbox page does', () => {
    expect(ResumeAttentionModel.targetOf({ sessionId: 'session-1', signal: signal(), continuation })).toEqual({ kind: 'inbox', itemId: 'item-1' })
  })

  it('falls back to the stored continuation when no inbox item names the row', () => {
    expect(ResumeAttentionModel.targetOf({ sessionId: 'session-1', signal: undefined, continuation })).toEqual({
      kind: 'quota',
      continuationId: 'continuation-1',
    })
  })

  it('resumes the interrupted turn itself when neither an item nor a continuation exists', () => {
    expect(ResumeAttentionModel.targetOf({ sessionId: 'session-1', signal: undefined, continuation: undefined })).toEqual({
      kind: 'recovery',
      sessionId: 'session-1',
    })
  })

  it('ignores an inbox item whose verb is something else', () => {
    expect(ResumeAttentionModel.targetOf({ sessionId: 'session-1', signal: signal({ verb: 'Retry' }), continuation: undefined })).toEqual({
      kind: 'recovery',
      sessionId: 'session-1',
    })
  })
})

describe('group-wide resume rows', () => {
  it('takes every row whose status verb is Resume and nothing else', () => {
    const rows = ['resumable', 'answerable', 'idle']
    const statuses = new Map<string, ThreadStatus>([
      ['resumable', status()],
      ['answerable', status({ status: 'needs-you', verb: 'Answer' })],
    ])
    expect(ResumeAttentionModel.resumableRowsOf({ rows, statusOf: row => statuses.get(row) })).toEqual(['resumable'])
  })
})
