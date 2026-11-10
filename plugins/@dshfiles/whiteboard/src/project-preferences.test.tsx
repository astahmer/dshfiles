// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { projectPreferences } from './project-preferences.js'

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => localStorage.clear())

describe('whiteboard panel project preferences', () => {
  it('isolates simultaneous occurrences and restores each selection', async () => {
    const first = projectPreferences('first')
    const second = projectPreferences('second')
    const values = new Map<string, string | null>()
    const Panel = (props: { id: string; store: typeof first }) => {
      values.set(props.id, props.store.useValue())
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        <>
          <Panel id="first" store={first} />
          <Panel id="second" store={second} />
        </>,
      ),
    )
    await act(async () => first.set('/first'))
    expect(values.get('first')).toBe('/first')
    expect(values.get('second')).toBe(null)
    await act(async () => second.set('/second'))
    expect(values.get('first')).toBe('/first')
    await act(async () => root.unmount())
    expect(projectPreferences('first').get()).toBe('/first')
    expect(projectPreferences('second').get()).toBe('/second')
  })

  it('preserves the legacy selection for the original panel', () => {
    projectPreferences(undefined).set('/legacy')
    expect(projectPreferences('dshfiles-whiteboard').get()).toBe('/legacy')
    expect(projectPreferences('new').get()).toBe(null)
  })
})
