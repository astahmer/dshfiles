import { describe, expect, it } from 'vitest'
import { workingThreadIds } from './working-threads.js'

describe('working thread view', () => {
  it('includes only currently running roots, including parents working through a child', () => {
    expect(
      workingThreadIds([
        { id: 'idle', running: false },
        { id: 'running', running: true },
        { id: 'parent-with-running-child', running: true },
      ]),
    ).toEqual(new Set(['running', 'parent-with-running-child']))
  })
})
