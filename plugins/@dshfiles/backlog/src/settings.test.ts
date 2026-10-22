import { describe, expect, it } from 'vitest'

import { backlogSettings } from './settings.js'

describe('backlog settings', () => {
  it('keeps threads started from items closed by default', () => {
    expect(backlogSettings.schema({}).startThreadOpensCreated).toBe(false)
  })

  it('keeps idle-thread nudges opt-in', () => {
    expect(backlogSettings.schema({}).idleThreadNudgeDays).toBe(0)
    expect(backlogSettings.schema({ idleThreadNudgeDays: 7 }).idleThreadNudgeDays).toBe(7)
  })
})
