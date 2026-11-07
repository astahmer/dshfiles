import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectionIndicatorMachine, connectionIndicatorState } from './connection-indicator-machine.js'

const start = (connectionState: ConnectionState | undefined = 'connected') => {
  const actor = createActor(connectionIndicatorMachine, { input: { connectionState } })
  actor.start()
  return actor
}

const phase = (actor: ReturnType<typeof start>) => connectionIndicatorState(actor.getSnapshot())

describe('connectionIndicatorMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts in the phase the current connection is already in', () => {
    expect(phase(start('connecting'))).toBe('connecting')
    expect(phase(start('disconnected'))).toBe('disconnected')
    expect(phase(start(undefined))).toBeUndefined()
  })

  it('holds a connecting attempt that started before the pill mounted', () => {
    const actor = start('connecting')
    vi.advanceTimersByTime(300)
    actor.send({ type: 'connection.changed', state: 'connected' })
    expect(phase(actor)).toBe('connecting')
    vi.advanceTimersByTime(500)
    expect(phase(actor)).toBe('recovered')
    actor.stop()
  })

  it('shows nothing while the connection is healthy', () => {
    const actor = start()
    actor.send({ type: 'connection.changed', state: 'connected' })
    expect(phase(actor)).toBeUndefined()
    actor.stop()
  })

  it('shows a disconnect until a reconnect confirms itself for two seconds', () => {
    const actor = start()
    actor.send({ type: 'connection.changed', state: 'disconnected' })
    expect(phase(actor)).toBe('disconnected')

    actor.send({ type: 'connection.changed', state: 'connected' })
    expect(phase(actor)).toBe('recovered')
    vi.advanceTimersByTime(1_999)
    expect(phase(actor)).toBe('recovered')
    vi.advanceTimersByTime(1)
    expect(phase(actor)).toBeUndefined()
    actor.stop()
  })

  it('holds a short connecting attempt for its minimum visible time before confirming', () => {
    const actor = start()
    actor.send({ type: 'connection.changed', state: 'connecting' })
    vi.advanceTimersByTime(300)

    actor.send({ type: 'connection.changed', state: 'connected' })
    expect(phase(actor)).toBe('connecting')
    vi.advanceTimersByTime(499)
    expect(phase(actor)).toBe('connecting')
    vi.advanceTimersByTime(1)
    expect(phase(actor)).toBe('recovered')

    vi.advanceTimersByTime(2_000)
    expect(phase(actor)).toBeUndefined()
    actor.stop()
  })

  it('holds a short failed attempt before showing the disconnect', () => {
    const actor = start()
    actor.send({ type: 'connection.changed', state: 'connecting' })
    vi.advanceTimersByTime(200)

    actor.send({ type: 'connection.changed', state: 'disconnected' })
    expect(phase(actor)).toBe('connecting')
    vi.advanceTimersByTime(600)
    expect(phase(actor)).toBe('disconnected')
    actor.stop()
  })

  it('confirms immediately when connecting already had its minimum visible time', () => {
    const actor = start()
    actor.send({ type: 'connection.changed', state: 'connecting' })
    vi.advanceTimersByTime(800)

    actor.send({ type: 'connection.changed', state: 'connected' })
    expect(phase(actor)).toBe('recovered')
    actor.stop()
  })

  it('follows the connection through a hold instead of confirming a stale outcome', () => {
    const actor = start()
    actor.send({ type: 'connection.changed', state: 'connecting' })
    vi.advanceTimersByTime(100)

    actor.send({ type: 'connection.changed', state: 'connected' })
    actor.send({ type: 'connection.changed', state: 'disconnected' })
    expect(phase(actor)).toBe('connecting')
    vi.advanceTimersByTime(700)
    expect(phase(actor)).toBe('disconnected')
    actor.stop()
  })

  it('restarts the minimum visible time when a new attempt begins during a hold', () => {
    const actor = start()
    actor.send({ type: 'connection.changed', state: 'connecting' })
    vi.advanceTimersByTime(200)
    actor.send({ type: 'connection.changed', state: 'connected' })
    vi.advanceTimersByTime(300)

    actor.send({ type: 'connection.changed', state: 'connecting' })
    expect(phase(actor)).toBe('connecting')
    vi.advanceTimersByTime(300)
    actor.send({ type: 'connection.changed', state: 'connected' })
    expect(phase(actor)).toBe('connecting')
    vi.advanceTimersByTime(499)
    expect(phase(actor)).toBe('connecting')
    vi.advanceTimersByTime(1)
    expect(phase(actor)).toBe('recovered')
    actor.stop()
  })

  it('drops the confirmation when the connection drops during the recovered phase', () => {
    const actor = start()
    actor.send({ type: 'connection.changed', state: 'disconnected' })
    actor.send({ type: 'connection.changed', state: 'connected' })
    actor.send({ type: 'connection.changed', state: 'disconnected' })
    expect(phase(actor)).toBe('disconnected')
    vi.advanceTimersByTime(2_000)
    expect(phase(actor)).toBe('disconnected')
    actor.stop()
  })

  it('leaves the disconnect pill for a connecting attempt', () => {
    const actor = start()
    actor.send({ type: 'connection.changed', state: 'disconnected' })
    actor.send({ type: 'connection.changed', state: 'connecting' })
    expect(phase(actor)).toBe('connecting')
    actor.stop()
  })
})
