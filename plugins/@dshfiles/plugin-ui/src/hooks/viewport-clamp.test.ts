import { viewportClampShift } from './viewport-clamp.js'
import { expect, test } from 'vitest'

test('a submenu that fits beside its trigger is not moved', () => {
  expect(viewportClampShift({ left: 900, width: 220, viewportWidth: 1440 })).toBe(0)
})

test('a phone submenu opened past either edge slides back inside the viewport margins', () => {
  expect(viewportClampShift({ left: 371, width: 218, viewportWidth: 390 })).toBe(164 - 371)
  expect(viewportClampShift({ left: -171, width: 218, viewportWidth: 390 })).toBe(8 + 171)
})

test('a submenu wider than the viewport keeps its left edge on screen', () => {
  expect(viewportClampShift({ left: -40, width: 500, viewportWidth: 390 })).toBe(48)
})
