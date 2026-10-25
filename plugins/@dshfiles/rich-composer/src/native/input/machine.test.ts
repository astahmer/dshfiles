import { describe, expect, it } from 'vitest'
import { SubmitMachine } from './machine.js'

describe('SubmitMachine', () => {
  it('does not cancel an in-flight default send when its composer releases', () => {
    const machine = new SubmitMachine()
    const [effect] = machine.dispatch({ type: 'enter', mode: 'queue', draft: 'A sent answer' })
    if (effect?.type !== 'default-sink') throw new Error('expected a default-send effect')

    machine.dispatch({ type: 'release' })

    expect(effect.attempt.signal.aborted).toBe(false)
  })
})
