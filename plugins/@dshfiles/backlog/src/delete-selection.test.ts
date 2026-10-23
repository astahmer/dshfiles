import { describe, expect, it } from 'vitest'

import { deleteSelection } from './delete-selection.js'

describe('delete selection', () => {
  it('starts every selected deletion before waiting for any response', async () => {
    const started: number[] = []
    const pending = new Map<number, (value: void) => void>()
    const deletion = deleteSelection({
      ids: [12, 14, 19],
      remove: id =>
        new Promise<void>(resolve => {
          started.push(id)
          pending.set(id, resolve)
        }),
    })

    expect(started).toEqual([12, 14, 19])
    pending.forEach(resolve => resolve(undefined))
    await expect(deletion).resolves.toBeUndefined()
  })
})
