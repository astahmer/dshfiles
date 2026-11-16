// @vitest-environment jsdom
import { PluginQueryProvider, pluginQueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { WhatsNew } from './whats-new-model.js'
import { WhatsNewSection } from './whats-new-section.js'

afterEach(() => {
  cleanup()
  pluginQueryClient().clear()
})

const entry = (plugin: string, summary: string, date: string, kind: 'feat' | 'fix' = 'feat') => ({
  commit: `${plugin.slice(0, 4).padEnd(4, '0')}${date.slice(8, 10)}000000`,
  plugin,
  kind,
  breaking: false,
  summary,
  date,
})

const ready: WhatsNew = {
  state: 'ready',
  vcs: 'jj',
  bookmark: 'main',
  entries: [
    entry('onboarding', 'show what is new', '2026-11-11T10:00:00.000Z'),
    entry('backlog', 'keep the order', '2026-11-10T10:00:00.000Z', 'fix'),
    entry('onboarding', 'walk a feature', '2026-11-09T10:00:00.000Z'),
  ],
  more: false,
  upstream: [
    {
      remote: 'fork-source',
      bookmark: 'main',
      entries: [entry('backlog', 'only upstream has this', '2026-11-11T12:00:00.000Z')],
      more: false,
      fetchCommand: 'jj git fetch --remote fork-source',
    },
  ],
  plugins: [
    { name: 'onboarding', description: 'Getting started.', features: 5 },
    { name: 'backlog', description: 'Backlog items.', features: 0 },
  ],
  commitsUrl: 'https://github.com/astahmer/dshfiles/commits/main',
}

/** The section as the page mounts it, with last-seen held in state the way the browser store holds it. */
const Harness = (props: { readonly value: WhatsNew; readonly initialSeen: string | null }) => {
  const [lastSeen, setLastSeen] = useState(props.initialSeen)
  return <WhatsNewSection copy={async () => true} lastSeen={lastSeen} loadWhatsNew={async () => props.value} markSeen={setLastSeen} />
}

const mount = (value: WhatsNew, initialSeen: string | null = null) =>
  render(
    <PluginQueryProvider>
      <Harness initialSeen={initialSeen} value={value} />
    </PluginQueryProvider>,
  )

describe('WhatsNewSection', () => {
  it('leads with features, as sentences, newest first; fixes and the rest are one click away', async () => {
    mount(ready)
    const section = await screen.findByRole('region', { name: /What's new/u })
    const changes = within(section).getByRole('list', { name: 'Changes' })
    const summaries = (): (string | null)[] => [...changes.querySelectorAll('[data-whats-new-summary]')].map(line => line.textContent)
    // A list of repairs is not what is new for a user: the fix is not in the default list.
    expect(summaries()).toEqual(['Show what is new', 'Walk a feature'])
    expect(within(changes).queryByText('Fix')).toBeNull()
    expect(section.textContent).not.toMatch(/\bfeat\b|\bfix\b|Onboarding|Backlog|Getting started\./u)
    expect(within(section).queryAllByText('New')).toEqual([])
    // The heading no longer carries the size of the history ("What's new 50").
    expect(within(section).getByRole('heading', { name: "What's new" }).parentElement?.textContent).not.toMatch(/\d/u)
    fireEvent.click(within(section).getByRole('button', { name: 'Show all 3 changes' }))
    expect(summaries()).toEqual(['Show what is new', 'Keep the order', 'Walk a feature'])
    expect(within(changes).getAllByText('Fix')).toHaveLength(1)
    fireEvent.click(within(section).getByRole('button', { name: 'Show features only' }))
    expect(summaries()).toEqual(['Show what is new', 'Walk a feature'])
  })

  it('shows at most five features, in a reserved chip column, with no ISO date', async () => {
    const many: WhatsNew = {
      ...ready,
      entries: Array.from({ length: 9 }, (_, index) =>
        entry('onboarding', `feature ${String(index + 1)}`, `2026-11-${String(20 - index).padStart(2, '0')}T10:00:00.000Z`),
      ),
    }
    // Two of the five landed since the last visit, so two lines carry New and three carry nothing.
    mount(many, '2026-11-18T12:00:00.000Z')
    const section = await screen.findByRole('region', { name: /What's new/u })
    const lines = [...within(section).getByRole('list', { name: 'Changes' }).querySelectorAll('li')]
    expect(lines).toHaveLength(5)
    expect(within(section).getAllByText('New')).toHaveLength(2)
    for (const line of lines) {
      // Every line reserves the chip column, so a line with a chip and one without start their sentence on one edge.
      expect(line.firstElementChild?.getAttribute('data-whats-new-chip')).toBe('')
      expect(line.querySelector('time')?.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/u)
    }
    expect(within(section).getByRole('button', { name: 'Show all 9 changes' })).toBeTruthy()
    // With no chip on any line there is no column to reserve, and no empty indent.
    fireEvent.click(within(section).getByRole('button', { name: 'Mark as seen' }))
    expect(section.querySelectorAll('[data-whats-new-chip]')).toHaveLength(0)
  })

  it('marks what landed since the last visit as New until the user marks it seen, never on its own', async () => {
    mount(ready, '2026-11-09T12:00:00.000Z')
    const section = await screen.findByRole('region', { name: /What's new/u })
    expect(within(section).getByText('2 new')).toBeTruthy()
    // The new feature shows at once; the new fix says so under Show all.
    expect(within(section).getAllByText('New')).toHaveLength(1)
    fireEvent.click(within(section).getByRole('button', { name: 'Show all 3 changes' }))
    expect(within(section).getAllByText('New fix')).toHaveLength(1)
    fireEvent.click(within(section).getByRole('button', { name: 'Mark as seen' }))
    expect(within(section).queryAllByText(/^New/u)).toEqual([])
    expect(within(section).queryByRole('button', { name: 'Mark as seen' })).toBeNull()
  })

  it('folds upstream changes and the fetch status into a quiet detail with the fetch command to copy', async () => {
    mount(ready)
    const section = await screen.findByRole('region', { name: /What's new/u })
    const upstream = section.querySelector('details[data-whats-new-upstream="fork-source"]')
    if (!(upstream instanceof HTMLDetailsElement)) throw new Error('no upstream detail')
    expect(upstream.open).toBe(false)
    expect(upstream.querySelector('summary')?.textContent).toBe('1 newer change not in your copy yet')
    expect(within(upstream).getByText('Only upstream has this')).toBeTruthy()
    expect(upstream.textContent).toContain('On main@fork-source as of the last fetch.')
    expect(within(upstream).getByRole('button', { name: 'Copy jj git fetch --remote fork-source', hidden: true })).toBeTruthy()
  })

  it('says why history is missing and links the repository commits instead of a dead end', async () => {
    mount({ state: 'no-checkout', reason: 'This profile does not link Getting started from a dshfiles checkout.', commitsUrl: ready.commitsUrl })
    const section = await screen.findByRole('region', { name: /What's new/u })
    expect(section.dataset.whatsNew).toBe('no-checkout')
    expect(within(section).getByRole('link', { name: 'Open the commits on GitHub' }).getAttribute('href')).toBe(ready.commitsUrl)
  })

  it('renders nothing while the Host reports the setting off', async () => {
    mount({ state: 'off' })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('region', { name: /What's new/u })).toBeNull()
  })
})
