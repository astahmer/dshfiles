import { describe, expect, it } from 'vitest'

import { backlogSettings } from './settings.js'

describe('backlog settings', () => {
  it('keeps threads started from items closed by default', () => {
    expect(backlogSettings.schema({}).startThreadOpensCreated).toBe(false)
  })
})
