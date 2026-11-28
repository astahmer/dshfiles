import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeveloperToolsRow } from './general-section.js'
import type { ShellTranslate } from './locales.js'

const t: ShellTranslate = key => key

/** A Host observable the test moves by hand, as the config form does once a write is accepted. */
const observable = (initial: boolean) => {
  let value = initial
  const listeners = new Set<() => void>()
  // SAFETY: the row reads only getSnapshot and subscribe of the observable.
  const source = {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as never as ObservableSnapshot<boolean>
  return {
    source,
    set: (next: boolean) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

/** A write that settles only when the test says so (the Host took 660 ms in the friction audit). */
const pendingWrite = () => {
  let settle: (accepted: boolean) => void = () => undefined
  const write = vi.fn(
    () =>
      new Promise<void>((resolvePromise, reject) => {
        settle = accepted => (accepted ? resolvePromise() : reject(new Error('refused')))
      }),
  )
  return { write, settle: (accepted: boolean) => settle(accepted) }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const toggle = (): HTMLButtonElement => {
  const element = container.querySelector<HTMLButtonElement>('[role="switch"]')
  if (element === null) throw new Error('no switch rendered')
  return element
}

describe('the Developer tools switch (round three item 29)', () => {
  it('flips at once while the Host saves, stays enabled and keeps focus', async () => {
    const enabled = observable(false)
    const write = pendingWrite()
    await act(async () => root.render(<DeveloperToolsRow enabled={enabled.source} setEnabled={write.write} t={t} />))
    toggle().focus()
    await act(async () => toggle().click())

    expect(write.write).toHaveBeenCalledWith(true)
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(toggle().getAttribute('aria-busy')).toBe('true')
    expect(toggle().disabled).toBe(false)
    expect(document.activeElement).toBe(toggle())

    await act(async () => {
      enabled.set(true)
      write.settle(true)
    })
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(toggle().hasAttribute('aria-busy')).toBe(false)
  })

  it('reverts and says so when the Host refuses, keeping focus', async () => {
    const enabled = observable(false)
    const write = pendingWrite()
    await act(async () => root.render(<DeveloperToolsRow enabled={enabled.source} setEnabled={write.write} t={t} />))
    toggle().focus()
    await act(async () => toggle().click())
    await act(async () => write.settle(false))

    expect(toggle().getAttribute('aria-checked')).toBe('false')
    expect(toggle().hasAttribute('aria-busy')).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('developerTools.error')
    expect(document.activeElement).toBe(toggle())
  })
})
