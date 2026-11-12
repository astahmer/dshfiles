// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { observeStandaloneDisplay } from '../src/client/host-commands.js'

// The part of MediaQueryList this test drives: a change listener's target with its current match.
type MediaQueryListDouble = EventTarget & { media: string; matches: boolean }

it('tracks standalone and window-controls-overlay changes', () => {
  const lists = new Map<string, MediaQueryListDouble>()
  const matchMedia = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const list: MediaQueryListDouble = Object.assign(new EventTarget(), { media: query, matches: false })
      lists.set(query, list)
      return list
    },
  })
  const display = observeStandaloneDisplay(window)
  const standalone = lists.get('(display-mode: standalone)')
  const overlay = lists.get('(display-mode: window-controls-overlay)')
  if (standalone === undefined || overlay === undefined) throw new Error('missing media queries')
  expect(display.matches()).toBe(false)
  Object.assign(standalone, { matches: true })
  standalone.dispatchEvent(new Event('change'))
  expect(display.matches()).toBe(true)
  Object.assign(standalone, { matches: false })
  Object.assign(overlay, { matches: true })
  overlay.dispatchEvent(new Event('change'))
  expect(display.matches()).toBe(true)
  Object.assign(overlay, { matches: false })
  overlay.dispatchEvent(new Event('change'))
  expect(display.matches()).toBe(false)
  display.dispose()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })
})
