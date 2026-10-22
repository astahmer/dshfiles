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

  it('defaults reply routing to keywords and routed-thread notices to in-app', () => {
    const settings = backlogSettings.schema({})
    expect(settings.smartThreadRouting).toBe(true)
    expect(settings.threadStartNotifications).toBe('in-app')
    expect(settings.replyThreadThreshold).toBe(0.7)
  })

  it.each(['off', 'in-app', 'system', 'both'] as const)('accepts %s thread-start notifications', notification => {
    expect(backlogSettings.schema({ threadStartNotifications: notification }).threadStartNotifications).toBe(notification)
  })
})
