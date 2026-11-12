import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WelcomeNotice, WelcomeNoticeStore, type WelcomeTranslate } from './welcome-notice.js'

const t: WelcomeTranslate = key => key

type ShellPreferences = { readonly previewNotice?: boolean }

const formOf = (value: ShellPreferences, status: ConfigFormSnapshot<unknown>['status'] = 'ready') => {
  let snapshot: ConfigFormSnapshot<unknown> = { status, value, base: {}, user: value, revision: 1, writable: true }
  const listeners = new Set<() => void>()
  const form: ConfigForm<unknown> = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mutate: async () => true,
    set: async () => true,
    unset: async () => true,
  }
  const load = (next: ShellPreferences): void => {
    snapshot = { ...snapshot, status: 'ready', value: next, user: next }
    for (const listener of listeners) listener()
  }
  return { form, load }
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

const mount = async (form: ConfigForm<unknown>) => {
  const complete = vi.fn()
  const store = new WelcomeNoticeStore(form)
  await act(async () => root.render(<WelcomeNotice complete={complete} controller={store} t={t} />))
  return { complete, store }
}

describe('WelcomeNotice', () => {
  it('skips the upstream preview notice by default, so the setup card is the only first-run surface', async () => {
    const notice = await mount(formOf({}).form)
    expect(document.body.textContent).not.toContain('welcomeTitle')
    expect(notice.complete).toHaveBeenCalled()
    notice.store.dispose()
  })

  it('waits for the Host settings before deciding, then shows the notice when previewNotice is on', async () => {
    const scope = formOf({}, 'loading')
    const notice = await mount(scope.form)
    expect(notice.complete).not.toHaveBeenCalled()
    await act(async () => scope.load({ previewNotice: true }))
    expect(document.body.textContent).toContain('welcomeTitle')
    expect(notice.complete).not.toHaveBeenCalled()
    notice.store.dispose()
  })
})
