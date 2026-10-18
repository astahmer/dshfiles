import { describe, expect, it } from 'vitest'
import { indexSessionActivity, type IndexedSessionActivity } from './panel-session-activity.js'

const session = (cwd: string | null | undefined, running = false, waitingForInput = false): IndexedSessionActivity => ({ cwd, running, waitingForInput })

describe('session activity index', () => {
  it('answers a cwd from every session that shares it, listed or not', () => {
    const index = indexSessionActivity([
      session('/w/one', false, false),
      session('/w/one', true, false),
      session('/w/two', false, true),
      session(null, true, true),
      session(undefined, true, true),
    ])
    expect(index.activityAt('/w/one')).toEqual({ running: true, waitingForInput: false })
    expect(index.activityAt('/w/two')).toEqual({ running: false, waitingForInput: true })
    expect(index.activityAt('/w/three')).toEqual({ running: false, waitingForInput: false })
    expect(index.activityAt(null)).toEqual({ running: false, waitingForInput: false })
  })

  it('walks the session store once, not once per lookup', () => {
    let consumed = 0
    const many: Iterable<IndexedSessionActivity> = {
      *[Symbol.iterator]() {
        for (let position = 0; position < 2_000; position += 1) {
          consumed += 1
          yield session(`/w/${String(position % 100)}`, position % 7 === 0, position % 11 === 0)
        }
      },
    }
    const index = indexSessionActivity(many)
    expect(consumed).toBe(2_000)
    for (let lookup = 0; lookup < 1_000; lookup += 1) index.activityAt(`/w/${String(lookup % 100)}`)
    expect(consumed).toBe(2_000)
  })

  it('keeps a running session without a cwd out of every workspace', () => {
    const index = indexSessionActivity([session(null, true, true), session('/w/one')])
    expect(index.activityAt('/w/one')).toEqual({ running: false, waitingForInput: false })
  })
})
