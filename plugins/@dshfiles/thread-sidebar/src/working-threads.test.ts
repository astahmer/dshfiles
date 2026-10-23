import { describe, expect, it } from 'vitest'
import { workingThreadIds } from './working-threads.js'

describe('working thread view', () => {
  it('includes threads whose own turn runs and parents whose subagent runs', () => {
    expect(
      workingThreadIds([
        { session: { id: 'idle', running: false }, activity: { running: false } },
        { session: { id: 'running', running: true }, activity: { running: true } },
        { session: { id: 'parent-with-running-child', running: false }, activity: { running: true } },
      ]),
    ).toEqual(new Set(['running', 'parent-with-running-child']))
  })
})
