import { describe, expect, it } from 'vitest'

import { NoteSelectionModel } from './note-selection.js'

describe('note selection', () => {
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
