import { expect, test } from 'vitest'
import { shouldBootstrapRemoteSession } from './remote-session-bootstrap-policy.js'

test('bootstrap waits for an existing session owner check', () => {
  expect(
    shouldBootstrapRemoteSession({
      currentSessionId: 'session-1',
      ownerKnown: false,
      ownerRuntimeId: undefined,
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(false)
})

test('bootstrap skips the remote session it just opened', () => {
  expect(
    shouldBootstrapRemoteSession({
      currentSessionId: 'session-1',
      ownerKnown: true,
      ownerRuntimeId: 'runtime-a',
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(false)
})

test('bootstrap can switch destinations from a thread owned by another runtime', () => {
  expect(
    shouldBootstrapRemoteSession({
      currentSessionId: 'session-1',
      ownerKnown: true,
      ownerRuntimeId: 'runtime-b',
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(true)
})

test('bootstrap can start a new thread from a local or new-chat screen', () => {
  expect(
    shouldBootstrapRemoteSession({
      currentSessionId: 'session-local',
      ownerKnown: true,
      ownerRuntimeId: null,
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(true)
  expect(
    shouldBootstrapRemoteSession({
      currentSessionId: undefined,
      ownerKnown: false,
      ownerRuntimeId: undefined,
      destinationRuntimeId: 'runtime-a',
    }),
  ).toBe(true)
})
