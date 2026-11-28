import { expect, test } from 'vitest'
import { announceableEvents } from './alert-announcements.js'
import type { AlertEvent } from './alert-types.js'

// SAFETY: announceableEvents reads only `kind`; the rest of an event does not matter here.
const event = (id: number, kind: AlertEvent['kind']): AlertEvent => ({ id, kind }) as AlertEvent

test('a resolved alert is not announced unless the user asked for it', () => {
  const events = [event(2, 'resolved'), event(1, 'firing')]
  expect(announceableEvents(events, { announceResolved: false, alertsOnScreen: false }).map(entry => entry.id)).toEqual([1])
  expect(announceableEvents(events, { announceResolved: true, alertsOnScreen: false }).map(entry => entry.id)).toEqual([2, 1])
})

test('nothing is announced while the Alerts view already shows it', () => {
  expect(announceableEvents([event(1, 'firing')], { announceResolved: true, alertsOnScreen: true })).toEqual([])
})
