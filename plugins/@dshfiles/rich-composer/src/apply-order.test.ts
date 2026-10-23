import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A hot replacement disposes the old client fiber before the new one applies.
 * The composer bar and the dock inject `conversation` while they render, so the
 * root service must already be registered by then; source order in `apply()`
 * is what guarantees it. A behavioral test needs a live Cordis client tree, so
 * this records the invariant directly.
 */
describe('conversation service registration order', () => {
  it('registers the controller before the slots that inject it', () => {
    const source = readFileSync(fileURLToPath(new URL('./native/apply.ts', import.meta.url)), 'utf8')
    const controller = source.indexOf('ctx.plugin(ConversationController')
    const slots = source.indexOf("slots.inject('main'")

    expect(controller).toBeGreaterThan(-1)
    expect(slots).toBeGreaterThan(-1)
    expect(controller).toBeLessThan(slots)
  })
})
