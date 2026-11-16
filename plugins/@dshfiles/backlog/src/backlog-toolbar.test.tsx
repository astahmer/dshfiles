// @vitest-environment jsdom
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { BacklogViewSwitch, FilterMenu, ViewMenu } from './backlog-toolbar.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Reflect.set(globalThis, 'ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

const render = (element: JSX.Element): void => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<TooltipProvider>{element}</TooltipProvider>))
}

const byName = (role: string, name: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>(role === 'button' ? 'button' : `[role="${role}"]`)].find(
    element => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === name,
  )

test('every Backlog view is a labelled tab, and one labelled select stands in on a phone', () => {
  render(<BacklogViewSwitch view="items" onSelect={() => undefined} modifierHeld={false} />)
  const nav = document.querySelector('nav[aria-label="Backlog views"]')
  const tabs = [...(nav?.querySelectorAll('button') ?? [])]
  expect(tabs.map(tab => tab.textContent)).toEqual(['Feed', 'Inbox', 'Items', 'Board', 'Projects', 'Shipped', 'Ready'])
  expect(nav?.querySelector('svg')).toBeNull()
  expect(tabs.find(tab => tab.getAttribute('aria-current') === 'page')?.textContent).toBe('Items')
  expect(byName('combobox', 'Backlog view')).toBeDefined()
})

test('the toolbar folds project scope, sort, agent items and saved views into one View menu', () => {
  render(
    <>
      <ViewMenu
        projects={[]}
        projectPaths={['/work/sample']}
        setProjects={() => undefined}
        sort={{ value: 'updated', allowsPriority: true, set: () => undefined }}
        agentItems={{ hidden: true, hiddenCount: 2, toggle: () => undefined }}
        savedViews={{ views: [], query: '', view: 'feed', writable: true, save: () => undefined, apply: () => undefined }}
      />
      <FilterMenu kinds={[]} setKinds={() => undefined} showDormant={false} setShowDormant={() => undefined} />
    </>,
  )
  expect(byName('combobox', 'Filter by project')).toBeUndefined()
  const trigger = byName('button', 'Backlog view options')
  expect(trigger?.dataset.variant).toBe('ghost')
  expect(byName('button', 'Filter')?.dataset.variant).toBe('ghost')
  act(() => trigger?.click())
  expect(byName('combobox', 'Filter by project')).toBeDefined()
  expect(byName('button', 'Sort by last update')).toBeDefined()
  const agentItems = [...document.querySelectorAll('button')].find(button => button.textContent?.startsWith('Hide agent items') === true)
  expect(agentItems?.getAttribute('aria-pressed')).toBe('true')
  expect([...document.querySelectorAll('button')].some(button => button.textContent?.startsWith('Saved views') === true)).toBe(true)
})
