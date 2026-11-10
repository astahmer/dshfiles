import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { createAutosaveMachine, type AutosaveOptions } from '../src/autosave-machine.js'

type SaveCall = { readonly value: string; readonly resolve: () => void; readonly reject: (error: unknown) => void }

const errorMessageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const deferred = () => {
  let resolve: () => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const createClock = () => {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>()
  return {
    clock: {
      setTimeout: (run: () => void, timeout: number): number => {
        nextId += 1
        timers.set(nextId, { at: now + timeout, run })
        return nextId
      },
      clearTimeout: (id: number): void => {
        timers.delete(id)
      },
    },
    advance: (ms: number): void => {
      now += ms
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((left, right) => left[1].at - right[1].at)
      for (const [id, timer] of due) {
        timers.delete(id)
        timer.run()
      }
    },
  }
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const harness = (options: AutosaveOptions<string> = {}) => {
  const calls: SaveCall[] = []
  const machine = createAutosaveMachine<string>(options)
  const { clock, advance } = createClock()
  const actor = createActor(machine, {
    clock,
    input: {
      value: 'original',
      save: async value => {
        const pending = deferred()
        calls.push({ value, resolve: pending.resolve, reject: pending.reject })
        return pending.promise
      },
    },
  })
  actor.start()
  return { actor, calls, advance }
}

describe('autosave machine', () => {
  it('debounces an edit into one save and reports it saved', async () => {
    const { actor, calls, advance } = harness({ delayMs: 150 })

    actor.send({ type: 'edit', value: 'next' })
    expect(actor.getSnapshot().matches('dirty')).toBe(true)
    expect(calls).toHaveLength(0)

    advance(149)
    expect(actor.getSnapshot().matches('dirty')).toBe(true)
    expect(calls).toHaveLength(0)

    advance(1)
    expect(actor.getSnapshot().matches('saving')).toBe(true)
    expect(calls.map(call => call.value)).toEqual(['next'])

    calls[0]?.resolve()
    await settle()
    expect(actor.getSnapshot().matches('saved')).toBe(true)
    expect(actor.getSnapshot().context.persisted).toBe('next')
  })

  it('restarts the debounce on a newer edit instead of saving the stale value', () => {
    const { actor, calls, advance } = harness({ delayMs: 150 })

    actor.send({ type: 'edit', value: 'first' })
    advance(100)
    actor.send({ type: 'edit', value: 'second' })
    advance(149)
    expect(calls).toHaveLength(0)

    advance(1)
    expect(calls.map(call => call.value)).toEqual(['second'])
  })

  it('never runs two saves at once and saves the newer draft after the run in flight', async () => {
    const { actor, calls } = harness()

    actor.send({ type: 'flush' })
    actor.send({ type: 'flush' })
    actor.send({ type: 'edit', value: 'newer' })
    expect(calls.map(call => call.value)).toEqual(['original'])
    expect(actor.getSnapshot().matches('saving')).toBe(true)

    calls[0]?.resolve()
    await settle()
    expect(actor.getSnapshot().matches('saving')).toBe(true)
    expect(calls.map(call => call.value)).toEqual(['original', 'newer'])
    expect(actor.getSnapshot().context.persisted).toBe('original')

    calls[1]?.resolve()
    await settle()
    expect(actor.getSnapshot().matches('saved')).toBe(true)
    expect(actor.getSnapshot().context.persisted).toBe('newer')
  })

  it('returns to dirty instead of saved when a save resolves after a newer edit', async () => {
    const { actor, calls, advance } = harness({ delayMs: 150 })

    actor.send({ type: 'edit', value: 'first' })
    advance(150)
    actor.send({ type: 'edit', value: 'second' })

    calls[0]?.resolve()
    await settle()
    expect(actor.getSnapshot().matches('dirty')).toBe(true)

    advance(150)
    expect(calls.map(call => call.value)).toEqual(['first', 'second'])
  })

  it('keeps the draft and error after a failure, then retries with the same value', async () => {
    const { actor, calls } = harness()

    actor.send({ type: 'edit', value: 'changed' })
    actor.send({ type: 'flush' })
    calls[0]?.reject(new Error('Host is down'))
    await settle()

    expect(actor.getSnapshot().matches('failed')).toBe(true)
    expect(actor.getSnapshot().context.draft).toBe('changed')
    expect(errorMessageOf(actor.getSnapshot().context.error)).toBe('Host is down')

    actor.send({ type: 'flush' })
    expect(actor.getSnapshot().matches('saving')).toBe(true)
    expect(actor.getSnapshot().context.error).toBeNull()
    expect(calls.map(call => call.value)).toEqual(['changed', 'changed'])

    calls[1]?.resolve()
    await settle()
    expect(actor.getSnapshot().matches('saved')).toBe(true)
  })

  it('flushes on leave while a save is running without dropping that save', async () => {
    const { actor, calls } = harness()

    actor.send({ type: 'edit', value: 'leaving' })
    actor.send({ type: 'flush' })
    actor.send({ type: 'flush' })
    expect(calls).toHaveLength(1)

    calls[0]?.resolve()
    await settle()
    expect(actor.getSnapshot().matches('saved')).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('saves an edit made while saving after the run in flight, without a stale debounce', () => {
    const { actor, calls, advance } = harness({ delayMs: 150 })

    actor.send({ type: 'edit', value: 'first' })
    advance(150)
    expect(calls).toHaveLength(1)

    actor.send({ type: 'edit', value: 'second' })
    advance(1000)
    expect(calls).toHaveLength(1)
  })

  it('applies an external sync only while nothing local is pending', async () => {
    const { actor, calls } = harness()

    actor.send({ type: 'sync', value: 'external' })
    expect(actor.getSnapshot().context.draft).toBe('external')

    actor.send({ type: 'edit', value: 'local' })
    actor.send({ type: 'sync', value: 'external again' })
    expect(actor.getSnapshot().context.draft).toBe('local')

    actor.send({ type: 'flush' })
    calls[0]?.resolve()
    await settle()
    actor.send({ type: 'sync', value: 'external again' })
    expect(actor.getSnapshot().context.draft).toBe('external again')
    expect(actor.getSnapshot().matches('saved')).toBe(true)
  })

  it('discards a draft on cancel and starts editing from the persisted value', async () => {
    const { actor, calls } = harness()
    actor.send({ type: 'edit', value: 'discarded' })
    actor.send({ type: 'edit', value: 'discarded too' })
    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().matches('synced')).toBe(true)
    expect(actor.getSnapshot().context.draft).toBe('original')
    expect(calls).toHaveLength(0)

    actor.send({ type: 'begin', value: 'original' })
    expect(actor.getSnapshot().matches('dirty')).toBe(true)
  })
})
