import { describe, expect, it } from 'vitest'
import { workingThreadIds } from './working-threads.js'

describe('working thread view', () => {
  it('includes only threads whose own turn is running, not parents waiting on a running child', () => {
    expect(
      workingThreadIds([
        { session: { id: 'idle', running: false } },
        { session: { id: 'running', running: true } },
        { session: { id: 'parent-with-running-child', running: false } },
      ]),
    ).toEqual(new Set(['running']))
  })
})
