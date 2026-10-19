import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsDocumentState } from './native/document-action.js'
import {
  openConfigMachine,
  type ConfigFileOpeners,
  type DocumentLocation,
  type OpenConfigMachineInput,
  type SettingsDocumentController,
} from './open-config-machine.js'

const readyState: SettingsDocumentState = { status: 'ready', opening: false, error: null }

const createController = (
  options: {
    readonly load?: () => Promise<void>
    readonly open?: () => Promise<void>
  } = {},
): SettingsDocumentController => {
  const store: ObservableSnapshot<SettingsDocumentState> = {
    getSnapshot: () => readyState,
    subscribe: () => () => undefined,
  }
  return {
    store,
    load: options.load ?? (async () => undefined),
    open: options.open ?? (async () => undefined),
  }
}

const createOpeners = (overrides: Partial<ConfigFileOpeners> = {}): ConfigFileOpeners => ({
  documentPath: async () => ({ path: '/profile/settings.yml', exists: true }),
  canOpenPaths: async () => true,
  applications: async () => [],
  openDefault: async () => true,
  openWith: async () => true,
  reveal: async () => true,
  openInEditor: undefined,
  ...overrides,
})

const start = (input: OpenConfigMachineInput) => createActor(openConfigMachine, { input }).start()

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('open config machine', () => {
  it('catches a controller load rejection and opens an existing document with the default app', async () => {
    const load = vi.fn(async () => {
      throw new Error('settings mirror unavailable')
    })
    const openDefault = vi.fn(async () => true)
    const actor = start({
      controller: createController({ load }),
      openers: createOpeners({ openDefault }),
      copyPath: async () => true,
    })

    await waitFor(actor, snapshot => snapshot.context.location?.path === '/profile/settings.yml' && snapshot.context.desktop === true)
    actor.send({ type: 'primary' })
    await waitFor(actor, snapshot => snapshot.matches({ active: 'ready' }))

    expect(load).toHaveBeenCalledOnce()
    expect(openDefault).toHaveBeenCalledWith('/profile/settings.yml')
    actor.stop()
  })

  it('opens the native document when no local file exists', async () => {
    const nativeOpen = vi.fn(async () => undefined)
    const openDefault = vi.fn(async () => true)
    const actor = start({
      controller: createController({ open: nativeOpen }),
      openers: createOpeners({ documentPath: async () => ({ path: '/profile/settings.yml', exists: false }), openDefault }),
      copyPath: async () => true,
    })

    actor.send({ type: 'primary' })
    await waitFor(actor, snapshot => snapshot.matches({ active: 'ready' }) && snapshot.context.location?.exists === false)
    await vi.waitFor(() => expect(nativeOpen).toHaveBeenCalledOnce())

    expect(nativeOpen).toHaveBeenCalledOnce()
    expect(openDefault).not.toHaveBeenCalled()
    actor.stop()
  })

  it('uses the native opener when desktop path opening is unavailable', async () => {
    const nativeOpen = vi.fn(async () => undefined)
    const openDefault = vi.fn(async () => true)
    const actor = start({
      controller: createController({ open: nativeOpen }),
      openers: createOpeners({ canOpenPaths: async () => false, openDefault }),
      copyPath: async () => true,
    })

    await waitFor(actor, snapshot => snapshot.context.location !== null && snapshot.context.desktop === false)
    actor.send({ type: 'primary' })
    await vi.waitFor(() => expect(nativeOpen).toHaveBeenCalledOnce())

    expect(openDefault).not.toHaveBeenCalled()
    actor.stop()
  })

  it('discards a slow initial path after a newer primary lookup starts', async () => {
    const initialLocation = deferred<DocumentLocation | null>()
    const primaryLocation = deferred<DocumentLocation | null>()
    const documentPath = vi
      .fn<ConfigFileOpeners['documentPath']>()
      .mockImplementationOnce(() => initialLocation.promise)
      .mockImplementationOnce(() => primaryLocation.promise)
    const actor = start({
      controller: createController(),
      openers: createOpeners({ documentPath }),
      copyPath: async () => true,
    })

    await vi.waitFor(() => expect(documentPath).toHaveBeenCalledOnce())
    actor.send({ type: 'primary' })
    await vi.waitFor(() => expect(documentPath).toHaveBeenCalledTimes(2))
    primaryLocation.resolve({ path: '/profile/new-settings.yml', exists: false })
    await waitFor(actor, snapshot => snapshot.matches({ active: 'ready' }) && snapshot.context.location?.path === '/profile/new-settings.yml')

    initialLocation.resolve({ path: '/profile/old-settings.yml', exists: true })
    await Promise.resolve()
    await Promise.resolve()

    expect(actor.getSnapshot().context.location?.path).toBe('/profile/new-settings.yml')
    actor.stop()
  })

  it('refreshes app availability and reports successful path copying', async () => {
    const applications = vi.fn(async () => [])
    const copyPath = vi.fn(async () => true)
    const actor = start({
      controller: createController(),
      openers: createOpeners({ applications }),
      copyPath,
    })

    await waitFor(actor, snapshot => snapshot.context.location !== null && snapshot.context.desktop === true)
    actor.send({ type: 'menu.open' })
    await waitFor(actor, snapshot => snapshot.matches({ active: 'ready' }) && snapshot.context.apps !== undefined)
    expect(applications).toHaveBeenCalledWith('/profile/settings.yml')

    actor.send({ type: 'copy.path' })
    await waitFor(actor, snapshot => snapshot.context.feedback?.kind === 'copied')
    expect(copyPath).toHaveBeenCalledWith('/profile/settings.yml')
    actor.stop()
  })

  it('reports rejected menu actions as feedback instead of leaking the rejection', async () => {
    const reveal = vi.fn(async () => {
      throw new Error('file manager unavailable')
    })
    const actor = start({
      controller: createController(),
      openers: createOpeners({ reveal }),
      copyPath: async () => true,
    })

    await waitFor(actor, snapshot => snapshot.context.location !== null)
    actor.send({ type: 'reveal' })
    await waitFor(actor, snapshot => snapshot.context.feedback?.kind === 'error')

    expect(reveal).toHaveBeenCalledWith('/profile/settings.yml')
    expect(actor.getSnapshot().context.feedback).toEqual({ kind: 'error', key: 'config.failed' })
    actor.stop()
  })

  it('ignores duplicate primary gestures and late completion after stop', async () => {
    const pendingOpen = deferred<boolean>()
    const openDefault = vi.fn(() => pendingOpen.promise)
    const actor = start({
      controller: createController(),
      openers: createOpeners({ openDefault }),
      copyPath: async () => true,
    })

    await waitFor(actor, snapshot => snapshot.context.location !== null && snapshot.context.desktop === true)
    actor.send({ type: 'primary' })
    actor.send({ type: 'primary' })
    await waitFor(actor, snapshot => snapshot.matches({ active: 'primaryLoading' }))
    await vi.waitFor(() => expect(openDefault).toHaveBeenCalledOnce())

    actor.stop()
    pendingOpen.resolve(false)
    await Promise.resolve()

    expect(actor.getSnapshot().context.feedback).toBeNull()
  })

  it('expires feedback through the machine timer', async () => {
    vi.useFakeTimers()
    const actor = start({
      controller: createController(),
      openers: createOpeners({ openDefault: async () => false }),
      copyPath: async () => true,
    })

    try {
      actor.send({ type: 'primary' })
      await waitFor(actor, snapshot => snapshot.context.feedback?.kind === 'error')
      vi.advanceTimersByTime(2_500)
      await Promise.resolve()
      expect(actor.getSnapshot().context.feedback).toBeNull()
    } finally {
      actor.stop()
      vi.useRealTimers()
    }
  })
})
