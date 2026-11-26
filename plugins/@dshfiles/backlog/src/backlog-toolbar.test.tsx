// @vitest-environment jsdom
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { BacklogViewSwitch, FilterMenu, ToolbarDivider, ViewMenu } from './backlog-toolbar.js'

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
  // On a phone the select sits beside View and Filter: the same control height, not the 28 px small size.
  expect(byName('combobox', 'Backlog view')?.dataset.size).toBe('default')
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
  // One secondary look beside a search field (council round 18, D3): the kit's quiet secondary at the search field's
  // control height and the compact toolbar type: the trigger fill and hairline, the label in secondary ink, no
  // per-state ink of its own.
  for (const control of [trigger, byName('button', 'Filter')]) {
    expect(control?.dataset.variant).toBe('quiet')
    expect(control?.dataset.size).toBe('field')
    expect(control?.className).toContain('dshx:bg-trigger-fill')
    expect(control?.className).toContain('dshx:not-disabled:hover:border-field-border')
    expect(control?.className).toContain('dshx:h-(--dshx-control-h)')
    expect(control?.className).not.toContain('dshx:h-7')
    expect(control?.className).not.toContain('dshx:text-foreground ')
  }
  act(() => trigger?.click())
  expect(byName('combobox', 'Filter by project')).toBeDefined()
  expect(byName('button', 'Sort by last update')).toBeDefined()
  const agentItems = [...document.querySelectorAll('button')].find(button => button.textContent?.startsWith('Hide agent items') === true)
  expect(agentItems?.getAttribute('aria-pressed')).toBe('true')
  expect([...document.querySelectorAll('button')].some(button => button.textContent?.startsWith('Saved views') === true)).toBe(true)
})

test('a 16 px neutral rule sits before the search field with 12 px on each side (council round 18, D3)', () => {
  render(<ToolbarDivider />)
  const seat = document.querySelector<HTMLElement>('[data-toolbar-divider]')
  // The row's gap is 8 px: 4 px of padding each side makes 12 px; the seat takes the free space, so search keeps its edge.
  expect(seat?.getAttribute('aria-hidden')).toBe('true')
  expect(seat?.className).toContain('dshx:ml-auto')
  expect(seat?.className).toContain('dshx:px-1')
  expect(seat?.className).toContain('dshx:@max-pane-narrow:hidden')
  const rule = seat?.firstElementChild
  expect(rule?.className).toContain('dshx:h-4')
  expect(rule?.className).toContain('dshx:w-px')
  expect(rule?.className).toContain('dshx:bg-border')
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
