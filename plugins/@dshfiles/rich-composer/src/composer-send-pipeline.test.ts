import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerSendPipeline } from './composer-send-pipeline.ts'
import type { ComposerSendPreparer } from './composer-send.ts'

const input = (text = 'hello') => ({ sessionId: 's1', text, signal: new AbortController().signal })

describe('ComposerSendPipeline', () => {
  let unbind: () => void = () => {}
  afterEach(() => {
    unbind()
    vi.restoreAllMocks()
  })

  it('sends the text unchanged without preparers', async () => {
    await expect(ComposerSendPipeline.prepare(input())).resolves.toBe('hello')
  })

  it('runs preparers in order, each on the previous text', async () => {
    const preparers: ComposerSendPreparer[] = [
      { id: 'b', order: 20, prepare: async ({ text }) => ({ text: `${text}-b` }) },
      { id: 'a', order: 10, prepare: async ({ text }) => ({ text: `${text}-a` }) },
      { id: 'keep', order: 30, prepare: async () => undefined },
    ]
    unbind = ComposerSendPipeline.bind(() => preparers)
    await expect(ComposerSendPipeline.prepare(input())).resolves.toBe('hello-a-b')
  })

  it('skips a preparer that throws, so a failing provider never blocks the send', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    unbind = ComposerSendPipeline.bind(() => [
      { id: 'boom', prepare: () => Promise.reject(new Error('host gone')) },
      { id: 'after', order: 200, prepare: async ({ text }) => ({ text: `${text}!` }) },
    ])
    await expect(ComposerSendPipeline.prepare(input())).resolves.toBe('hello!')
  })

  it('skips a preparer slower than its budget', async () => {
    unbind = ComposerSendPipeline.bind(() => [{ id: 'slow', prepare: () => new Promise(() => {}) }])
    await expect(ComposerSendPipeline.prepare(input(), 20)).resolves.toBe('hello')
  })

  it('rejects when the send is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(ComposerSendPipeline.prepare({ sessionId: 's1', text: 'x', signal: controller.signal })).rejects.toThrow()
  })

  it('a stale unbind leaves the newer source in place', async () => {
    const first = ComposerSendPipeline.bind(() => [{ id: 'one', prepare: async () => ({ text: 'one' }) }])
    unbind = ComposerSendPipeline.bind(() => [{ id: 'two', prepare: async () => ({ text: 'two' }) }])
    first()
    await expect(ComposerSendPipeline.prepare(input())).resolves.toBe('two')
  })
})
