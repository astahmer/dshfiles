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

  it('keeps plain replies as context unless smart thread routing is enabled', () => {
    const settings = backlogSettings.schema({})
    expect(settings.smartThreadRouting).toBe(false)
    expect(backlogSettings.schema({ smartThreadRouting: true }).smartThreadRouting).toBe(true)
    expect(settings.threadStartNotifications).toBe('in-app')
    expect(settings.replyThreadThreshold).toBe(0.7)
    expect(settings.smartReplyAnswers).toBe(true)
    expect(settings.replyAgent).toBe('')
    expect(settings.replyAgentOrder).toBe('preferred')
  })

  it('keeps reply-answer defaults and thread notices', () => {
    const settings = backlogSettings.schema({})
    expect(settings.threadStartNotifications).toBe('in-app')
    expect(settings.replyThreadThreshold).toBe(0.7)
    expect(settings.smartReplyAnswers).toBe(true)
    expect(settings.replyAgent).toBe('')
    expect(settings.replyAgentOrder).toBe('preferred')
  })

  it.each(['preferred', 'last-used'] as const)('accepts %s generated-reply agent order', replyAgentOrder => {
    expect(backlogSettings.schema({ replyAgentOrder }).replyAgentOrder).toBe(replyAgentOrder)
  })

  it.each(['off', 'in-app', 'system', 'both'] as const)('accepts %s thread-start notifications', notification => {
    expect(backlogSettings.schema({ threadStartNotifications: notification }).threadStartNotifications).toBe(notification)
  })
})
