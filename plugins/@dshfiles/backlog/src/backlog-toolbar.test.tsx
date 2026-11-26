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
  // The view of items waiting on a decision is Triage: Inbox is the app's one Inbox (council round 9, D2).
  expect(tabs.map(tab => tab.textContent)).toEqual(['Feed', 'Triage', 'Items', 'Board', 'Projects', 'Shipped', 'Ready'])
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
  // Filter-row grammar (council round 8, D2): beside the search field, the triggers that show a value (the project
  // scope, the active filter count) take the field look, at the search's 28 px.
  for (const control of [trigger, byName('button', 'Filter')]) {
    expect(control?.dataset.variant).toBe('field')
    expect(control?.className).toContain('dshx:border-field-border')
    expect(control?.className).toContain('dshx:h-7')
  }
  act(() => trigger?.click())
  expect(byName('combobox', 'Filter by project')).toBeDefined()
  expect(byName('button', 'Sort by last update')).toBeDefined()
  const agentItems = [...document.querySelectorAll('button')].find(button => button.textContent?.startsWith('Hide agent items') === true)
  expect(agentItems?.getAttribute('aria-pressed')).toBe('true')
  expect([...document.querySelectorAll('button')].some(button => button.textContent?.startsWith('Saved views') === true)).toBe(true)
})

test('the seven views are underline tabs, not a segmented track (council round 3, D2)', () => {
  render(<BacklogViewSwitch view="feed" onSelect={() => undefined} modifierHeld={false} />)
  const nav = document.querySelector('nav[aria-label="Backlog views"]')
  expect(nav?.getAttribute('data-tabs')).toBe('underline')
  expect(nav?.className).not.toContain('dshx:bg-muted')
  const tabs = [...(nav?.querySelectorAll('button') ?? [])]
  const active = tabs.find(tab => tab.getAttribute('aria-current') === 'page')
  expect(active?.className).toContain('dshx:after:opacity-100')
  expect(active?.className).not.toContain('dshx:shadow-sm')
  for (const tab of tabs.filter(tab => tab !== active)) expect(tab.className).toContain('dshx:text-muted-foreground')
})
