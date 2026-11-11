// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it } from 'vitest'
import type { InboxFilter } from './inbox-model.js'
import { InboxFilters } from './inbox-filters.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

const Harness = (): JSX.Element => {
  const [filter, setFilter] = useState<InboxFilter>('all')
  return <InboxFilters countOf={value => (value === 'blocked' ? 0 : 2)} filter={filter} onChange={setFilter} />
}

const radio = (name: string): HTMLElement => {
  const match = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(element => element.textContent?.startsWith(name) === true)
  if (match === undefined) throw new Error(`no ${name} filter`)
  return match
}

it('filters the inbox with one keyboard stop and arrow keys between filters', async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<Harness />))
  expect(document.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Inbox filters')
  expect(document.querySelector('[role="tab"]')).toBeNull()
  const all = radio('All')
  expect(all.getAttribute('aria-checked')).toBe('true')
  expect(radio('Needs you').tabIndex).toBe(-1)
  act(() => all.focus())
  await act(async () => {
    all.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  expect(document.activeElement).toBe(radio('Needs you'))
  act(() => radio('Needs you').click())
  expect(radio('Needs you').getAttribute('aria-checked')).toBe('true')
  act(() => radio('Needs you').click())
  expect(radio('Needs you').getAttribute('aria-checked')).toBe('true')
})
