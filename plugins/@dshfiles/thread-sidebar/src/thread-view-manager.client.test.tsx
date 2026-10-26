// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ThreadViewManager } from './thread-view-manager.js'
import { DEFAULT_THREAD_VIEW_SETTINGS, ThreadViewPreferencesModel, type ThreadViewSettings } from './thread-view-preferences.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('opens and saves a named view on plain HTTP without crypto.randomUUID', async () => {
  // HTTP LAN pages expose getRandomValues but not the secure-context-only randomUUID.
  vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
  expect(globalThis.crypto.randomUUID).toBeUndefined()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  const saved: ThreadViewSettings[] = []
  render(
    <ThreadViewManager
      open
      onOpenChange={() => {}}
      settings={DEFAULT_THREAD_VIEW_SETTINGS}
      onSettingsChange={settings => {
        saved.push(settings)
        return true
      }}
      t={key => key}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'threadSidebarAddView' }))
  expect(screen.getByRole('heading', { name: 'threadSidebarAddView' })).toBeDefined()
  fireEvent.change(screen.getByRole('textbox', { name: /threadSidebarViewName/u }), { target: { value: 'Later' } })
  fireEvent.click(screen.getByRole('button', { name: 'threadSidebarSaveView' }))

  await waitFor(() => expect(saved).toHaveLength(1))
  const document = saved[0]
  expect(ThreadViewPreferencesModel.decodeThreadViewSettings(document)).toEqual(document)
  expect(document?.views.at(-1)).toEqual({
    id: expect.stringMatching(/^custom-[a-f0-9]{32}$/u),
    name: 'Later',
    enabled: true,
    showCount: true,
    groupBy: 'status',
    statusFilters: [],
    sourceFilter: 'all',
  })
})
