import { describe, expect, test } from 'vitest'
import type { WorkspaceSetup } from './api.js'
import { awaitWorkspaceSetup, setupWaitsForRun } from './workspace-setup-wait.js'

const setup = (overrides: Partial<WorkspaceSetup> = {}): WorkspaceSetup => ({
  applies: true,
  awaitsFirstTurn: true,
  tasks: [{ id: 'a'.repeat(64), actionId: 'install', label: 'pnpm install', status: 'running', phase: 'starting' }],
  ...overrides,
})

const clock = (start = 0) => {
  let time = start
  return { now: () => time, advance: (milliseconds: number) => (time += milliseconds) }
}

const neverAborted = new AbortController().signal

describe('workspace setup before the first turn', () => {
  test('waits only when a selected action asked to hold the first turn', () => {
    expect(setupWaitsForRun(setup())).toBe(true)
    expect(setupWaitsForRun(setup({ awaitsFirstTurn: false }))).toBe(false)
    expect(setupWaitsForRun(setup({ applies: false }))).toBe(false)
    expect(setupWaitsForRun(setup({ tasks: [{ id: 'a'.repeat(64), actionId: 'install', label: 'install', status: 'succeeded', phase: 'recording' }] }))).toBe(
      false,
    )
  })

  test('releases the turn once the queue reports nothing open', async () => {
    const time = clock()
    const outcome = await awaitWorkspaceSetup({
      read: async () => setup({ tasks: [{ id: 'a'.repeat(64), actionId: 'install', label: 'install', status: 'succeeded', phase: 'recording' }] }),
      signal: neverAborted,
      now: time.now,
      wait: async () => undefined,
    })
    expect(outcome).toBe('settled')
  })

  test('keeps polling while the action runs, then settles', async () => {
    const time = clock()
    const reads = [setup(), setup(), setup({ tasks: [] })]
    const waits: number[] = []
    const outcome = await awaitWorkspaceSetup({
      read: async () => reads.shift() ?? setup({ tasks: [] }),
      signal: neverAborted,
      now: time.now,
      wait: async milliseconds => {
        waits.push(milliseconds)
        time.advance(milliseconds)
      },
    })
    expect(outcome).toBe('settled')
    expect(waits).toHaveLength(2)
  })

  test('gives up after the bound instead of holding the turn forever', async () => {
    const time = clock()
    const outcome = await awaitWorkspaceSetup({
      read: async () => setup(),
      signal: neverAborted,
      now: time.now,
      wait: async milliseconds => {
        time.advance(milliseconds)
      },
      timeoutMs: 2_000,
    })
    expect(outcome).toBe('timed-out')
  })

  test('stops when the send is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const outcome = await awaitWorkspaceSetup({
      read: async () => setup(),
      signal: controller.signal,
      now: () => 0,
      wait: async () => undefined,
    })
    expect(outcome).toBe('aborted')
  })
})
