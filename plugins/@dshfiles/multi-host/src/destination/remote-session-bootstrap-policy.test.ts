import { expect, test } from 'vitest'
import { shouldBootstrapRemoteSession, type ShownSession } from './remote-session-bootstrap-policy.js'

const blank = (sessionId: string): ShownSession => ({ kind: 'session', sessionId, blank: true })

test('bootstrap waits for an existing session owner check', () => {
  expect(
    shouldBootstrapRemoteSession({
      shown: blank('session-1'),
      ownerKnown: false,
      ownerRuntimeId: undefined,
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(false)
})

test('bootstrap skips the remote session it just opened', () => {
  expect(
    shouldBootstrapRemoteSession({
      shown: blank('session-1'),
      ownerKnown: true,
      ownerRuntimeId: 'runtime-a',
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(false)
})

test('bootstrap can switch destinations from a thread owned by another runtime', () => {
  expect(
    shouldBootstrapRemoteSession({
      shown: blank('session-1'),
      ownerKnown: true,
      ownerRuntimeId: 'runtime-b',
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(true)
})

test('bootstrap can start a new thread from a local or new-chat screen', () => {
  expect(
    shouldBootstrapRemoteSession({
      shown: blank('session-local'),
      ownerKnown: true,
      ownerRuntimeId: null,
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(true)
  expect(
    shouldBootstrapRemoteSession({
      shown: { kind: 'none' },
      ownerKnown: false,
      ownerRuntimeId: undefined,
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(true)
})

test('bootstrap stays off while the main view switches to a thread with turns', () => {
  expect(
    shouldBootstrapRemoteSession({
      shown: { kind: 'session', sessionId: 'session-busy', blank: false },
      ownerKnown: false,
      ownerRuntimeId: undefined,
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(false)
})

test('bootstrap waits for the shown Session to be listed', () => {
  expect(
    shouldBootstrapRemoteSession({
      shown: { kind: 'unlisted' },
      ownerKnown: false,
      ownerRuntimeId: undefined,
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(false)
})
