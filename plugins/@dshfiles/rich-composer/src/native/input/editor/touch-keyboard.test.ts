// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'

import { hasTouchKeyboard } from './view-binding.ts'

const desktopAgent = navigator.userAgent
afterEach(() => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: desktopAgent })
})

const reportsHoverPointer = (): void => {
  window.matchMedia = (query: string): MediaQueryList =>
    Object.assign(new EventTarget(), { matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined })
}

it('treats an Android phone that reports a hover-capable pointer as a touch keyboard', () => {
  reportsHoverPointer()
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (Linux; Android 14; 23090RA98G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  })
  expect(hasTouchKeyboard()).toBe(true)
})

it('keeps a desktop with a hover pointer on Enter-sends', () => {
  reportsHoverPointer()
  expect(hasTouchKeyboard()).toBe(false)
})
