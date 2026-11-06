import { describe, expect, it } from 'vitest'
import type { Occurrence } from '../contract/draft-editor.ts'
import type { DraftAttachmentId } from '../contract/input.ts'
import { DetachedSends, type FailedDraftRestore } from './detached-sends.js'

const occurrence = ({ offset, ref }: { offset: number; ref: string }): Occurrence => ({
  occurrenceId: 1,
  source: 'files',
  ref,
  offset,
  length: 1,
  label: ref,
  clipboardText: '@',
})

const record = ({ draft, ref, attachment = 'draft-attachment' }: {
  draft: string
  ref: string | undefined
  attachment?: string
}) => ({
  draft,
  occurrences: ref === undefined ? [] : [occurrence({ offset: 0, ref })],
  attachmentIds: [attachment as DraftAttachmentId],
})

const writeSpy = (revision: (index: number) => number) => {
  const snapshots: FailedDraftRestore[] = []
  return {
    snapshots,
    write: (snapshot: FailedDraftRestore) => {
      snapshots.push(snapshot)
      return revision(snapshots.length)
    },
  }
}

describe('DetachedSends', () => {
  it('holds one snapshot per detached send until it settles', () => {
    const sends = new DetachedSends()
    sends.capture({ seq: 1, record: record({ draft: 'A', ref: undefined }) })
    sends.capture({ seq: 2, record: record({ draft: 'B', ref: undefined }) })

    expect(sends.inflightCount).toBe(2)
    expect(sends.settle(1)?.draft).toBe('A')
    expect(sends.inflightCount).toBe(1)
    expect(sends.settle(1)).toBeUndefined()
  })

  it('buffers a failure that would overwrite the draft the user is typing', () => {
    const sends = new DetachedSends()
    const { snapshots, write } = writeSpy(() => 5)

    expect(sends.recordFailure({ seq: 1, record: record({ draft: 'A', ref: undefined }), draft: 'typed later', rev: 4 })).toBe(false)

    expect(sends.recordFailure({ seq: 2, record: record({ draft: 'B', ref: undefined }), draft: '', rev: 6 })).toBe(true)
    sends.restore(write)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.draft).toBe('A\n\nB')
  })

  it('restores every buffered failure in submission order with shifted chip offsets', () => {
    const sends = new DetachedSends()
    const { snapshots, write } = writeSpy(() => 7)

    sends.recordFailure({ seq: 2, record: record({ draft: 'second', ref: 'b' }), draft: '', rev: 3 })
    sends.recordFailure({ seq: 1, record: record({ draft: 'first', ref: 'a' }), draft: '', rev: 3 })
    sends.restore(write)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.draft).toBe('first\n\nsecond')
    expect(snapshots[0]?.occurrences.map(candidate => [candidate.ref, candidate.offset])).toEqual([['a', 0], ['b', 7]])
  })

  it('keeps its own restore from counting as an unrelated editor change', () => {
    const sends = new DetachedSends()
    const { snapshots, write } = writeSpy(() => 7)

    sends.recordFailure({ seq: 1, record: record({ draft: 'A', ref: undefined }), draft: '', rev: 3 })
    sends.restore((snapshot) => {
      sends.editorChanged()
      return write(snapshot)
    })

    sends.recordFailure({ seq: 2, record: record({ draft: 'B', ref: undefined }), draft: '', rev: 8 })
    sends.restore(write)

    expect(snapshots.map(snapshot => snapshot.draft)).toEqual(['A', 'A\n\nB'])
  })

  it('drops the buffers once the restored draft is sent again', () => {
    const sends = new DetachedSends()
    const { snapshots, write } = writeSpy(() => 7)

    sends.recordFailure({ seq: 1, record: record({ draft: 'A', ref: undefined }), draft: '', rev: 3 })
    sends.restore(write)
    sends.sent({ rev: 7 })

    sends.recordFailure({ seq: 2, record: record({ draft: 'B', ref: undefined }), draft: '', rev: 8 })
    sends.restore(write)

    expect(snapshots.map(snapshot => snapshot.draft)).toEqual(['A', 'B'])
  })

  it('forgets every snapshot on teardown', () => {
    const sends = new DetachedSends()
    const { snapshots, write } = writeSpy(() => 5)

    sends.capture({ seq: 1, record: record({ draft: 'A', ref: undefined }) })
    sends.recordFailure({ seq: 2, record: record({ draft: 'B', ref: undefined }), draft: '', rev: 3 })
    sends.clear()
    sends.restore(write)

    expect(sends.inflightCount).toBe(0)
    expect(snapshots).toEqual([])
  })
})
