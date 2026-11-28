import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectionBanner } from './connection-banner.js'
import type { ConnectionStripState } from './connection-strip.js'
import type { ShellTranslate } from './locales.js'
import { ReachabilityModel, type ReachabilityState } from './reachability.js'

const t: ShellTranslate = key => key

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const render = (state: ConnectionStripState, retry = vi.fn()) => {
  const strip = createSnapshotStore<ConnectionStripState>(state)
  const reachability = createSnapshotStore<ReachabilityState>(ReachabilityModel.initial)
  act(() => root.render(<ConnectionBanner t={t} strip={strip} reachability={reachability} retry={retry} />))
  return { strip, retry }
}

const banner = (): HTMLElement | null => container.querySelector('[data-connection-banner]')

describe('ConnectionBanner', () => {
  it('draws the strip on a desktop window, not only on a phone', () => {
    render('offline')
    expect(banner()?.dataset.connectionBanner).toBe('offline')
    expect(banner()?.textContent).toContain('connection.offline')
    expect(banner()?.querySelector('[data-health="down"]')).not.toBeNull()
  })

  it('offers Retry only when DSH is not connected', () => {
    const { strip, retry } = render('reconnecting')
    expect(banner()?.querySelector('[data-health="limited"]')).not.toBeNull()
    expect(banner()?.querySelector('button')).toBeNull()
    act(() => strip.set('offline'))
    const button = banner()?.querySelector('button')
    expect(button?.textContent).toBe('connection.retry')
    act(() => button?.click())
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('confirms the return, then leaves no strip behind', () => {
    const { strip } = render('connected')
    expect(banner()?.textContent).toContain('connection.connected')
    expect(banner()?.querySelector('[data-health="ok"]')).not.toBeNull()
    act(() => strip.set(undefined))
    expect(banner()).toBeNull()
  })

  it('says each change once through one polite node, empty while online', () => {
    const { strip } = render(undefined)
    const live = container.querySelector('[role="status"]')
    expect(live?.getAttribute('aria-live')).toBe('polite')
    expect(live?.textContent).toBe('')
    act(() => strip.set('reconnecting'))
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('connection.checking')
  })
})
