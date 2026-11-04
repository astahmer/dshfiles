// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/dom'
import { act, cleanup, render } from '@testing-library/react'
import { EntityList, EntityRow } from '../src/components/entity-row.js'
import { EmptyState, Page, PageSection } from '../src/components/page.js'
import { StatusGlyph, WorkStatusModel, workStatusValues, type WorkStatus } from '../src/components/work-status.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

interface ResizeHandle {
  readonly resize: (next: number) => void
}

/** A ResizeObserver whose width the test sets, so the compact header can be exercised in jsdom. */
const stubResizeObserver = (width: number): ResizeHandle => {
  const observed: { readonly observer: ResizeObserver; readonly callback: ResizeObserverCallback; readonly target: Element }[] = []
  let current = width
  class FakeResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      observed.push({ observer: this, callback: this.callback, target })
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => DOMRect.fromRect({ width: current, height: 100 }))
  return {
    resize: next => {
      current = next
      for (const { observer, callback, target } of observed) {
        const entry = {
          target,
          contentRect: DOMRect.fromRect({ width: next, height: 100 }),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } satisfies ResizeObserverEntry
        callback([entry], observer)
      }
    },
  }
}

describe('WorkStatus', () => {
  it('has exactly the six states of the status vocabulary', () => {
    expect(workStatusValues).toEqual(['working', 'needs-you', 'failed', 'ready', 'idle', 'done'])
    expect(workStatusValues.filter(WorkStatusModel.isAttention)).toEqual(['needs-you', 'failed'])
    expect(WorkStatusModel.isWorkStatus('needs-you')).toBe(true)
    expect(WorkStatusModel.isWorkStatus('attention')).toBe(false)
  })

  it('renders a labelled glyph per state, colourless while working', () => {
    const view = render(
      <>
        {workStatusValues.map(status => (
          <StatusGlyph key={status} status={status} />
        ))}
      </>,
    )
    for (const status of workStatusValues) {
      const glyph = view.getByRole('img', { name: WorkStatusModel.label(status) })
      expect(glyph.getAttribute('data-status')).toBe(status)
    }
    const classOf = (status: WorkStatus): string => view.getByRole('img', { name: WorkStatusModel.label(status) }).className
    expect(classOf('working')).toContain('text-muted-foreground')
    expect(classOf('needs-you')).toContain('text-info')
    expect(classOf('failed')).toContain('text-destructive')
    expect(classOf('idle')).not.toMatch(/text-/)
  })

  it('is hidden from assistive technology when decorative', () => {
    const view = render(<StatusGlyph status="failed" decorative label="Broken" />)
    expect(view.queryByRole('img')).toBeNull()
    expect(view.container.querySelector('[data-slot="status-glyph"]')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('EntityRow', () => {
  it('lays out glyph, title, meta and a separate trailing verb', () => {
    const onSelect = vi.fn()
    const onAnswer = vi.fn()
    const view = render(
      <EntityList>
        <EntityRow
          role="listitem"
          status="needs-you"
          heading="fix-auth"
          meta={<span>@luna</span>}
          onSelect={onSelect}
          trailing={
            <button type="button" onClick={onAnswer}>
              Answer
            </button>
          }
        />
      </EntityList>,
    )
    fireEvent.click(view.getByRole('button', { name: /fix-auth/ }))
    fireEvent.click(view.getByRole('button', { name: 'Answer' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(view.getByRole('listitem').getAttribute('data-status')).toBe('needs-you')
    expect(view.getByRole('button', { name: /fix-auth/ }).textContent).toContain('@luna')
  })

  it('bolds ready titles and mutes done ones', () => {
    const view = render(
      <>
        <EntityRow status="ready" heading="ready-one" />
        <EntityRow status="done" heading="done-one" />
        <EntityRow status="working" heading="working-one" />
      </>,
    )
    expect(view.getByText('ready-one').className).toContain('font-semibold')
    expect(view.getByText('done-one').className).toContain('text-muted-foreground')
    expect(view.getByText('working-one').className).not.toMatch(/font-semibold|text-muted-foreground/)
  })
})

describe('Page', () => {
  const actions = [
    { id: 'refresh', label: 'Refresh', onSelect: vi.fn() },
    { id: 'export', label: 'Export', onSelect: vi.fn(), placement: 'overflow' as const },
  ]

  it('renders one h1, the description, count and at most one primary action', () => {
    const add = vi.fn()
    const view = render(
      <Page
        heading="Hosts"
        description="Machines threads can run on."
        count={3}
        primaryAction={{ id: 'add', label: 'Add host', onSelect: add }}
        actions={actions}
      >
        <PageSection heading="Registered">
          <EmptyState>No hosts yet.</EmptyState>
        </PageSection>
      </Page>,
    )
    expect(view.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(view.getByRole('heading', { level: 1, name: 'Hosts' })).toBeTruthy()
    expect(view.getByText('Machines threads can run on.')).toBeTruthy()
    expect(view.getByText('3')).toBeTruthy()
    expect(view.getByRole('region', { name: 'Registered' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Add host' }))
    expect(add).toHaveBeenCalledTimes(1)
    expect(view.getByRole('button', { name: 'Add host' }).getAttribute('data-variant')).toBe('default')
    // Wide: inline actions are buttons; overflow-only actions sit behind the menu.
    expect(view.getByRole('button', { name: 'Refresh' }).getAttribute('data-variant')).toBe('outline')
    expect(view.queryByRole('button', { name: 'Export' })).toBeNull()
    expect(view.getByRole('button', { name: 'More actions' })).toBeTruthy()
  })

  it('folds inline header actions into the overflow menu below the compact width', () => {
    const observer = stubResizeObserver(1024)
    const view = render(<Page heading="Jobs" actions={actions} primaryAction={{ id: 'new', label: 'New', onSelect: vi.fn() }} />)
    expect(view.getByRole('button', { name: 'Refresh' })).toBeTruthy()
    act(() => observer.resize(390))
    expect(view.queryByRole('button', { name: 'Refresh' })).toBeNull()
    expect(view.getByRole('button', { name: 'More actions' })).toBeTruthy()
    // The primary action never folds.
    expect(view.getByRole('button', { name: 'New' })).toBeTruthy()
    expect(view.container.querySelector('[data-slot="page"]')?.hasAttribute('data-compact')).toBe(true)
  })

  it('renders tabs in the single segmented style and reports changes', () => {
    const onValueChange = vi.fn()
    const view = render(
      <Page
        heading="Memory"
        tabs={{
          label: 'Memory views',
          value: 'notes',
          onValueChange,
          items: [
            { value: 'notes', label: 'Notes', count: 4 },
            { value: 'threads', label: 'Threads' },
          ],
        }}
      >
        <p>body</p>
      </Page>,
    )
    expect(view.getByRole('tablist', { name: 'Memory views' }).getAttribute('data-variant')).toBe('default')
    expect(view.getByRole('tab', { name: /Notes/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.mouseDown(view.getByRole('tab', { name: 'Threads' }), { button: 0 })
    expect(onValueChange).toHaveBeenCalledWith('threads')
    expect(view.getByText('body')).toBeTruthy()
  })
})

describe('EmptyState', () => {
  it('renders one sentence and an optional action', () => {
    const onSelect = vi.fn()
    const view = render(<EmptyState action={{ label: 'Add server', onSelect }}>No MCP servers configured yet.</EmptyState>)
    expect(view.getByText('No MCP servers configured yet.').tagName).toBe('P')
    fireEvent.click(view.getByRole('button', { name: 'Add server' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
