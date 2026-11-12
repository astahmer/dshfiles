import { describe, expect, it } from 'vitest'
import { StageCover } from './stage-cover.js'

describe('StageCover', () => {
  it('notifies readers only when the covered state changes', () => {
    const seen: boolean[] = []
    const stop = StageCover.subscribe(() => seen.push(StageCover.get()))
    StageCover.set(true)
    StageCover.set(true)
    StageCover.set(false)
    stop()
    StageCover.set(true)
    expect(seen).toEqual([true, false])
    StageCover.set(false)
  })
})
