import { describe, expect, it } from 'vitest'
import type { CommandClaim, InputEvent } from '../contract/input.ts'
import { SubmitMachine } from './machine.js'

const claim: CommandClaim = {
  name: 'goal',
  token: '/goal ',
  submit: async () => ({ kind: 'success' }),
}

const attemptOf = (machine: SubmitMachine, draft: string) => {
  const [effect] = machine.dispatch({ type: 'enter', mode: 'queue', draft })
  if (effect?.type !== 'adjudicate' && effect?.type !== 'begin-submit') throw new Error('expected a frozen attempt effect')
  return effect.attempt
}

describe('SubmitMachine', () => {
  it('does not cancel an in-flight default send when its composer releases', () => {
    const machine = new SubmitMachine()
    const [effect] = machine.dispatch({ type: 'enter', mode: 'queue', draft: 'A sent answer' })
    if (effect?.type !== 'default-sink') throw new Error('expected a default-send effect')

    machine.dispatch({ type: 'release' })

    expect(effect.attempt.signal.aborted).toBe(false)
  })

  it('reports the busy guard only while a frozen command attempt holds the slot', () => {
    const machine = new SubmitMachine()
    expect(machine.busy).toBe(false)

    const attempt = attemptOf(machine, '/goal ship it')
    expect(machine.busy).toBe(true)

    machine.dispatch({ type: 'adjudicated', attempt, outcome: { claim } })
    expect(machine.busy).toBe(true)

    machine.dispatch({ type: 'submit-settled', attempt, ok: true, command: claim })
    expect(machine.busy).toBe(false)
  })

  it('resolves one restored command chip at a time', () => {
    const machine = new SubmitMachine()
    expect(machine.dispatch({ type: 'restore-request', token: '/goal ', rev: 3 })).toEqual([])

    const started = machine.dispatch({ type: 'restore-start' })
    expect(started).toHaveLength(1)
    const first = started[0]
    if (first?.type !== 'resolve-claim') throw new Error('expected a resolve-claim effect')
    expect(first.token).toBe('/goal ')
    expect(first.rev).toBe(3)
    expect(first.signal.aborted).toBe(false)

    machine.dispatch({ type: 'restore-request', token: '/other ', rev: 4 })
    expect(first.signal.aborted).toBe(true)
    const second = machine.dispatch({ type: 'restore-start' })
    if (second[0]?.type !== 'resolve-claim') throw new Error('expected a resolve-claim effect')

    expect(machine.dispatch({ type: 'restore-resolved', token: '/goal ', rev: 3, claim })).toEqual([])
    const applied = machine.dispatch({ type: 'restore-resolved', token: '/other ', rev: 4, claim })
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ type: 'apply-claim', token: '/other ', rev: 4 })
    expect(machine.dispatch({ type: 'restore-start' })).toEqual([])
  })

  it('drops a restored command chip when the draft moved on or the composer released', () => {
    const machine = new SubmitMachine()
    machine.dispatch({ type: 'restore-request', token: '/goal ', rev: 3 })
    const started = machine.dispatch({ type: 'restore-start' })
    const effect = started[0]
    if (effect?.type !== 'resolve-claim') throw new Error('expected a resolve-claim effect')

    machine.dispatch({ type: 'restore-cancel' })
    expect(effect.signal.aborted).toBe(true)
    expect(machine.dispatch({ type: 'restore-resolved', token: '/goal ', rev: 3, claim })).toEqual([])

    machine.dispatch({ type: 'restore-request', token: '/goal ', rev: 4 })
    machine.dispatch({ type: 'restore-start' })
    machine.dispatch({ type: 'restore-failed', token: '/goal ', rev: 5 })
    expect(machine.dispatch({ type: 'restore-resolved', token: '/goal ', rev: 4, claim })).toHaveLength(1)

    machine.dispatch({ type: 'restore-request', token: '/goal ', rev: 6 })
    machine.dispatch({ type: 'restore-start' })
    machine.dispatch({ type: 'release' })
    expect(machine.dispatch({ type: 'restore-resolved', token: '/goal ', rev: 6, claim })).toEqual([])
  })

  it('treats a restore request as the only pending one', () => {
    const machine = new SubmitMachine()
    machine.dispatch({ type: 'restore-request', token: '/goal ', rev: 3 })
    machine.dispatch({ type: 'restore-request', token: '/other ', rev: 3 })
    const started = machine.dispatch({ type: 'restore-start' })
    if (started[0]?.type !== 'resolve-claim') throw new Error('expected a resolve-claim effect')
    expect(started[0].token).toBe('/other ')
  })
})

describe('SubmitMachine event coverage', () => {
  it('accepts every restore event the shell sends', () => {
    const events: InputEvent[] = [
      { type: 'restore-request', token: '/goal ', rev: 1 },
      { type: 'restore-start' },
      { type: 'restore-resolved', token: '/goal ', rev: 1, claim },
      { type: 'restore-failed', token: '/goal ', rev: 1 },
      { type: 'restore-cancel' },
    ]
    const machine = new SubmitMachine()
    for (const event of events) expect(() => machine.dispatch(event)).not.toThrow()
  })
})
