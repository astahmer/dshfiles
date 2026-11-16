// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import type { BacklogStatus } from './item.js'
import { StatusFilterBar } from './status-filter-bar.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

const counts = { inbox: 2, todo: 0, doing: 1, done: 0, dropped: 0 } satisfies Record<BacklogStatus, number>

const Harness = (): JSX.Element => {
  const [statuses, setStatuses] = useState<readonly BacklogStatus[]>([])
  return (
    <StatusFilterBar
      counts={counts}
      statuses={statuses}
      toggle={status => setStatuses(current => (current.includes(status) ? current.filter(other => other !== status) : [...current, status]))}
      clear={() => setStatuses([])}
    />
  )
}

const chips = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Filter by status"] button')]
const chip = (label: string): HTMLButtonElement => {
  const match = chips().find(button => button.getAttribute('aria-label')?.startsWith(`${label},`) === true)
  if (match === undefined) throw new Error(`no ${label} filter`)
  return match
}

test('status filters are kit toggles with muted counts and no zero-count chips', () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<Harness />))
  expect(chips().map(button => button.getAttribute('aria-label'))).toEqual(['All statuses, 3 items', 'Inbox, 2 items', 'In progress, 1 item'])
  expect(chips().every(button => button.dataset.slot === 'toggle-group-item')).toBe(true)
  expect(document.querySelector('[role="group"] svg')).toBeNull()
  expect(chip('All statuses').getAttribute('aria-pressed')).toBe('true')
  act(() => chip('In progress').click())
  expect(chip('In progress').getAttribute('aria-pressed')).toBe('true')
  expect(chip('All statuses').getAttribute('aria-pressed')).toBe('false')
  act(() => chip('All statuses').click())
  expect(chip('In progress').getAttribute('aria-pressed')).toBe('false')
  expect(chip('All statuses').getAttribute('aria-pressed')).toBe('true')
})
