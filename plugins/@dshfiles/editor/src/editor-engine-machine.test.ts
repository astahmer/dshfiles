import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import type { CodeEditorEngine } from './code-editor.js'
import { editorEngineLoaderMachine } from './editor-engine-machine.js'

const engine: CodeEditorEngine = {
  name: 'test',
  create: () => {
    throw new Error('loader tests do not create an editor surface')
  },
}

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('editor engine loader machine', () => {
  it('loads once and keeps the engine ready through inactive panels', async () => {
    const loadEngine = vi.fn(async () => engine)
    const actor = createActor(editorEngineLoaderMachine, { input: { loadEngine } }).start()

    actor.send({ type: 'activate' })
    await waitFor(actor, snapshot => snapshot.matches('ready'))
    actor.send({ type: 'deactivate' })
    actor.send({ type: 'activate' })

    expect(loadEngine).toHaveBeenCalledOnce()
    expect(actor.getSnapshot().matches('ready')).toBe(true)
    expect(actor.getSnapshot().context.engine).toBe(engine)
    actor.stop()
  })

  it('cancels an obsolete load and ignores its late completion', async () => {
    const request = deferred<CodeEditorEngine>()
    const loadEngine = vi.fn(() => request.promise)
    const actor = createActor(editorEngineLoaderMachine, { input: { loadEngine } }).start()

    actor.send({ type: 'activate' })
    expect(actor.getSnapshot().matches('loading')).toBe(true)
    actor.send({ type: 'deactivate' })
    request.resolve(engine)
    await Promise.resolve()

    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.engine).toBeNull()
    actor.stop()
  })

  it('can retry after a failed load is deactivated', async () => {
    let attempts = 0
    const loadEngine = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('engine import failed')
      return engine
    })
    const actor = createActor(editorEngineLoaderMachine, { input: { loadEngine } }).start()

    actor.send({ type: 'activate' })
    await waitFor(actor, snapshot => snapshot.matches('error'))
    actor.send({ type: 'deactivate' })
    actor.send({ type: 'activate' })
    await waitFor(actor, snapshot => snapshot.matches('ready'))

    expect(loadEngine).toHaveBeenCalledTimes(2)
    expect(actor.getSnapshot().context.engine).toBe(engine)
    actor.stop()
  })

  it('recovers from an editor surface creation failure after deactivation', async () => {
    const loadEngine = vi.fn(async () => engine)
    const actor = createActor(editorEngineLoaderMachine, { input: { loadEngine } }).start()

    actor.send({ type: 'activate' })
    await waitFor(actor, snapshot => snapshot.matches('ready'))
    actor.send({ type: 'create.failed' })
    expect(actor.getSnapshot().matches('error')).toBe(true)
    actor.send({ type: 'deactivate' })
    actor.send({ type: 'activate' })
    await waitFor(actor, snapshot => snapshot.matches('ready'))

    expect(loadEngine).toHaveBeenCalledTimes(2)
    actor.stop()
  })
})
