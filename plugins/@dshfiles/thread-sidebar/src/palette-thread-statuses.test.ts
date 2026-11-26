import { describe, expect, it } from 'vitest'
import { PaletteThreadStatusesModel } from './palette-thread-statuses.js'
import { ThreadWorkStatusModel } from './thread-status-client.js'
import { AttentionSubtitleModel } from './attention-subtitle.js'
import type { RowInlineVerb } from './thread-status.js'

describe('palette thread statuses', () => {
  it("gives the palette the list's status and word, rebuilt only when the projection changes", () => {
    const store = ThreadWorkStatusModel.createStore()
    const source = PaletteThreadStatusesModel.sourceOf(store, status => (status === 'needs-you' ? 'Needs you' : status))
    expect(source.getSnapshot()).toBeNull()
    store.publish(new Map([['asks', { status: 'needs-you', detail: undefined }]]))
    const first = source.getSnapshot()
    expect(first?.get('asks')).toEqual({ status: 'needs-you', label: 'Needs you' })
    expect(source.getSnapshot()).toBe(first)
  })

  it('carries an attention thread\'s kind in the one word list, as the row\'s line 2 says it (council round 15 B3)', () => {
    const words = { question: 'Question', approval: 'Approval', failed: 'Failed' }
    const kindOf = (status: string, verb: RowInlineVerb | undefined, detail?: string): string | undefined =>
      AttentionSubtitleModel.kindOf({ status, verb, detail }, words)
    expect(kindOf('needs-you', 'Answer')).toBe('Question')
    expect(kindOf('needs-you', 'Approve', 'git push --force')).toBe('Approval')
    expect(kindOf('needs-you', 'Review')).toBe('Approval')
    expect(kindOf('failed', 'Retry', 'Turn failed')).toBe('Turn failed')
    expect(kindOf('failed', 'Retry')).toBe('Failed')
    expect(kindOf('working', undefined, 'Waiting on 1 subagent')).toBeUndefined()

    const store = ThreadWorkStatusModel.createStore()
    const source = PaletteThreadStatusesModel.sourceOf(store, status => status)
    store.publish(
      new Map([
        ['asks', { status: 'needs-you', detail: 'Pick one', kind: 'Question' }],
        ['idle', { status: 'idle', detail: undefined, kind: undefined }],
      ]),
    )
    expect(source.getSnapshot()?.get('asks')).toEqual({ status: 'needs-you', label: 'needs-you', kind: 'Question' })
    expect(source.getSnapshot()?.get('idle')).toEqual({ status: 'idle', label: 'idle' })
    // A changed kind alone is a new projection.
    const before = source.getSnapshot()
    store.publish(
      new Map([
        ['asks', { status: 'needs-you', detail: 'Pick one', kind: 'Approval' }],
        ['idle', { status: 'idle', detail: undefined, kind: undefined }],
      ]),
    )
    expect(source.getSnapshot()).not.toBe(before)
    expect(source.getSnapshot()?.get('asks')?.kind).toBe('Approval')
  })
})
