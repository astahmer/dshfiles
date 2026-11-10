import { describe, expect, it } from 'vitest'
import { motionTailNext } from '../src/motion-tail.js'

const next = (current: 'off' | 'running' | 'settling', input: { running: boolean; deferCompletedTurns: boolean }) => motionTailNext(current, input)

describe('motion tail', () => {
  it('follows a running Turn while folded turns are deferred', () => {
    expect(next('off', { running: true, deferCompletedTurns: true })).toBe('running')
  })

  it('keeps the tail after a Turn settles, then lets it elapse', () => {
    expect(next('running', { running: false, deferCompletedTurns: true })).toBe('settling')
  })

  it('stays off while nothing keeps running after a Turn already settled', () => {
    expect(next('off', { running: false, deferCompletedTurns: true })).toBe('off')
  })

  it('turns off at once when folded turns are not deferred', () => {
    expect(next('running', { running: true, deferCompletedTurns: false })).toBe('off')
    expect(next('settling', { running: false, deferCompletedTurns: false })).toBe('off')
  })
})
