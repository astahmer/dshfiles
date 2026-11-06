import { describe, expect, it, vi } from 'vitest'
import { applyFoldRequest, noFoldRequest } from '../src/native/chat/fold-request.ts'

describe('fold request', () => {
  it('keeps a tail request until a batch takes it over, then clears it', () => {
    const requested = applyFoldRequest(noFoldRequest, { kind: 'requestTail' }).request
    expect(requested).toEqual({ status: 'requested', landing: 'tail' })
    const retarget = vi.fn()
    const step = applyFoldRequest(requested, { kind: 'begin', landing: 'tail', retarget })
    expect(step.request).toEqual({ status: 'running', landing: 'tail', retarget })
    expect(step.retarget).toBe(false)
    expect(applyFoldRequest(step.request, { kind: 'finish' }).request).toEqual(noFoldRequest)
  })

  it('starts anchored when no request and no tail follow own the batch', () => {
    const retarget = vi.fn()
    const started = applyFoldRequest(noFoldRequest, { kind: 'begin', landing: 'anchored', retarget }).request
    expect(started).toEqual({ status: 'running', landing: 'anchored', retarget })
  })

  it('retargets a running batch instead of leaving a second request beside it', () => {
    const retarget = vi.fn()
    const running = applyFoldRequest(noFoldRequest, { kind: 'begin', landing: 'anchored', retarget }).request
    const step = applyFoldRequest(running, { kind: 'requestTail' })
    expect(step).toEqual({ request: { status: 'running', landing: 'tail', retarget }, retarget: true })
    expect(step.request.status === 'running' && step.request.retarget).toBe(retarget)
    expect(applyFoldRequest(running, { kind: 'begin', landing: 'tail', retarget: vi.fn() }).request).toBe(running)
  })

  it('has no retarget callback to call once a batch finished', () => {
    const retarget = vi.fn()
    const running = applyFoldRequest(noFoldRequest, { kind: 'begin', landing: 'tail', retarget }).request
    const finished = applyFoldRequest(running, { kind: 'finish' }).request
    expect(finished.status).toBe('none')
    expect(applyFoldRequest(finished, { kind: 'requestTail' })).toEqual({
      request: { status: 'requested', landing: 'tail' },
      retarget: false,
    })
    expect(retarget).not.toHaveBeenCalled()
  })
})
