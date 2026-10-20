import { describe, expect, it } from 'vitest'

import type { PanelNote } from './api.js'
import { NoteSelectionModel } from './note-selection.js'

const note = (input: { readonly id: number; readonly type: PanelNote['type']; readonly status?: PanelNote['status'] }): PanelNote => ({
  id: input.id,
  project: '/work/repo',
  type: input.type,
  scope: 'repo',
  confidence: 'stated',
  text: `note ${String(input.id)}`,
  sourceThread: null,
  sourceSeq: null,
  origin: 'agent',
  createdAt: 1,
  updatedAt: 1,
  citations: 0,
  status: input.status ?? 'valid',
  supersedes: null,
  supersededBy: null,
  reason: null,
})

describe('note selection', () => {
  it('orders selectable ids by the rendered type groups and skips invalid notes', () => {
    const ids = NoteSelectionModel.orderedSelectableIds({
      notes: [
        note({ id: 1, type: 'project' }),
        note({ id: 2, type: 'feedback' }),
        note({ id: 3, type: 'project', status: 'forgotten' }),
        note({ id: 4, type: 'reference' }),
      ],
      types: ['feedback', 'project', 'reference'],
    })
    expect(ids).toEqual([2, 1, 4])
  })

  it('forgets every selected note and keeps the failed ones out of the cleared set', async () => {
    const calls: { readonly id: number; readonly reason: string }[] = []
    const outcome = await NoteSelectionModel.forget({
      ids: [4, 5, 6],
      reason: 'obsolete after the pipeline change',
      forget: async input => {
        calls.push(input)
        if (input.id === 5) throw new Error('note is gone')
      },
    })
    expect(outcome).toEqual({ forgotten: [4, 6], failed: [5] })
    expect(calls.map(call => call.reason)).toEqual([
      'obsolete after the pipeline change',
      'obsolete after the pipeline change',
      'obsolete after the pipeline change',
    ])
  })

  it('does nothing for an empty selection', async () => {
    await expect(NoteSelectionModel.forget({ ids: [], reason: '', forget: async () => undefined })).resolves.toEqual({ forgotten: [], failed: [] })
  })
})
