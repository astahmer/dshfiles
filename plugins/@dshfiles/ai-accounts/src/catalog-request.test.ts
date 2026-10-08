import { describe, expect, it } from 'vitest'
import { createCatalogRequestGuard } from './catalog-request.js'

describe('catalog request ownership', () => {
  it('ignores an older account response after a newer check starts', () => {
    const guard = createCatalogRequestGuard()
    const firstAccountRequest = guard.start()
    const selectedAccountRequest = guard.start()

    expect(guard.isLatest(firstAccountRequest)).toBe(false)
    expect(guard.isLatest(selectedAccountRequest)).toBe(true)
  })

  it('invalidates outstanding responses when selection clears', () => {
    const guard = createCatalogRequestGuard()
    const request = guard.start()
    guard.invalidate()

    expect(guard.isLatest(request)).toBe(false)
  })
})
