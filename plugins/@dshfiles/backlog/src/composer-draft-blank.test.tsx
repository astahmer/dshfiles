// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'

const KEY = 'dshfiles.backlog.draft.v1'
let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  localStorage.clear()
})

interface DraftHandle {
  readonly text: string
  readonly setText: (value: string) => void
}

/** What the probe component saw on its last render. */
interface DraftProbe {
  latest?: DraftHandle
}

/** A fresh module, so the stored-value cache reads what localStorage holds now (a reload). */
const mountDraft = async (): Promise<{ readonly current: () => DraftHandle }> => {
  vi.resetModules()
  const { useComposerDraft } = await import('./composer-draft.js')
  const seen: DraftProbe = {}
  const Probe = (): null => {
    seen.latest = useComposerDraft('feed')
    return null
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<Probe />))
  return {
    current: () => {
      if (seen.latest === undefined) throw new Error('The draft hook did not render.')
      return seen.latest
    },
  }
}

// Council round 2, D2: the blank lines a send leaves behind kept the capture box tall and hid its placeholder.
test('blank lines are never stored as a draft', async () => {
  const draft = await mountDraft()
  act(() => draft.current().setText('\n\n'))
  expect(localStorage.getItem(KEY) ?? '{}').toBe('{}')
  act(() => draft.current().setText('Fix the totals'))
  expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ feed: 'Fix the totals' }))
})

test('a blank draft stored by an older build reopens empty, and a real one is kept', async () => {
  localStorage.setItem(KEY, JSON.stringify({ feed: '\n\n' }))
  expect((await mountDraft()).current().text).toBe('')
  act(() => root?.unmount())
  localStorage.setItem(KEY, JSON.stringify({ feed: 'Fix the totals' }))
  expect((await mountDraft()).current().text).toBe('Fix the totals')
})
