// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@dshfiles/plugin-ui/query'
import { FeedLook } from './feed-look.js'
import { useTagColors, type TagColorsView } from './use-tag-colors.js'

const stored = vi.hoisted(() => ({ tagColors: [{ tag: 'billing', slot: 4 }] }))
const setTagColor = vi.hoisted(() => vi.fn())

vi.mock('@dshfiles/dshx/client', () => ({
  useSettings: () => ({ value: { tagColors: stored.tagColors } }),
  useApi: () => ({ setTagColor }),
}))

let root: Root | undefined
let host: HTMLElement | undefined
let view: TagColorsView | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  setTagColor.mockReset()
})

const Probe = (props: { readonly report: (view: TagColorsView) => void }): null => {
  const current = useTagColors()
  useEffect(() => props.report(current))
  return null
}

const mount = (): void => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const client = new QueryClient()
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <Probe
          report={current => {
            view = current
          }}
        />
      </QueryClientProvider>,
    ),
  )
}

test('chips read the colour stored in Backlog settings, and other tags keep their hashed tone', () => {
  mount()
  expect(view?.tone('billing')).toBe('project-tone-balanced-4')
  expect(view?.tone('docs')).toBe(FeedLook.tagTone('docs'))
})

test('a pick shows at once and is written through setTagColor; clearing writes null and returns the default', async () => {
  setTagColor.mockImplementation(async (input: { tag: string; slot: number | null }) => input)
  mount()
  await act(async () => view?.choose('docs', 1))
  expect(setTagColor).toHaveBeenCalledWith({ tag: 'docs', slot: 1 })
  expect(view?.tone('docs')).toBe('project-tone-balanced-1')
  await act(async () => view?.choose('billing', null))
  expect(setTagColor).toHaveBeenLastCalledWith({ tag: 'billing', slot: null })
  expect(view?.tone('billing')).toBe(FeedLook.tagTone('billing'))
})

test('a refused pick goes back to the colour the settings hold', async () => {
  setTagColor.mockRejectedValue(new Error('refused'))
  mount()
  await act(async () => view?.choose('billing', 0))
  expect(view?.tone('billing')).toBe('project-tone-balanced-4')
})
