import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchTabDocking } from './tabs.js'

afterEach(() => {
  globalThis.dshfilesWorkbenchTabAsideV1 = undefined
})

it('delegates to native mode without a frame owner and preserves explicit docking rejection', () => {
  expect(WorkbenchTabDocking.request('thread:a')).toBeUndefined()
  const owner = vi.fn(() => false)
  const disconnect = WorkbenchTabDocking.register(owner)
  expect(WorkbenchTabDocking.request('thread:a')).toBe(false)
  expect(owner).toHaveBeenCalledExactlyOnceWith('thread:a')
  disconnect()
  expect(WorkbenchTabDocking.request('thread:a')).toBeUndefined()
})

it('shares docking admission across duplicated modules and protects a replacement from stale HMR cleanup', async () => {
  const owner = vi.fn(() => true)
  const disconnectOld = WorkbenchTabDocking.register(owner)
  vi.resetModules()
  const duplicate = await import('./tabs.js')
  expect(duplicate.WorkbenchTabDocking.request('thread:a')).toBe(true)
  const replacement = vi.fn(() => false)
  const disconnectCurrent = duplicate.WorkbenchTabDocking.register(replacement)
  disconnectOld()
  expect(WorkbenchTabDocking.request('thread:a')).toBe(false)
  expect(replacement).toHaveBeenCalledExactlyOnceWith('thread:a')
  disconnectCurrent()
  expect(WorkbenchTabDocking.request('thread:a')).toBeUndefined()
})

it('does not let an old registration of the same callback remove the current owner', () => {
  const callback = vi.fn(() => true)
  const disconnectOld = WorkbenchTabDocking.register(callback)
  const disconnectCurrent = WorkbenchTabDocking.register(callback)
  disconnectOld()
  expect(WorkbenchTabDocking.request('panel:jujutsu#scope')).toBe(true)
  disconnectCurrent()
  expect(WorkbenchTabDocking.request('panel:jujutsu#scope')).toBeUndefined()
})
