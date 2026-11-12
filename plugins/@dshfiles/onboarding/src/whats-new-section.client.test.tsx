// @vitest-environment jsdom
import { PluginQueryProvider, pluginQueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
const Harness = (props: { readonly value: WhatsNew; readonly initialSeen: string | null; readonly showFeatures: (plugin: string) => void }) => {
  const [lastSeen, setLastSeen] = useState(props.initialSeen)
  return (
    <WhatsNewSection
      copy={async () => true}
      lastSeen={lastSeen}
      loadWhatsNew={async () => props.value}
      markSeen={setLastSeen}
      showFeatures={props.showFeatures}
    />
  )
}

const mount = (value: WhatsNew, initialSeen: string | null = null) => {
  const showFeatures = vi.fn()
  render(
    <PluginQueryProvider>
      <Harness initialSeen={initialSeen} showFeatures={showFeatures} value={value} />
    </PluginQueryProvider>,
  )
  return { showFeatures }
}

describe('WhatsNewSection', () => {
  it('lists changes by plugin with no New badge on a first visit, and links a plugin to its features', async () => {
    const page = mount(ready)
    const section = await screen.findByRole('region', { name: /What's new/u })
    const onboarding = section.querySelector('[data-whats-new-plugin="onboarding"]')
    if (!(onboarding instanceof HTMLElement)) throw new Error('no onboarding group')
    expect(within(onboarding).getByText('Getting started.')).toBeTruthy()
    expect(within(onboarding).getByText('show what is new')).toBeTruthy()
    expect(within(section).queryAllByText('New')).toEqual([])
    fireEvent.click(within(section).getByRole('button', { name: 'Features of Onboarding' }))
    expect(page.showFeatures).toHaveBeenCalledWith('onboarding')
    expect(within(section).queryByRole('button', { name: 'Features of Backlog' })).toBeNull()
  })

  it('marks what landed since the last visit as New until the user marks it seen, never on its own', async () => {
    mount(ready, '2026-11-09T12:00:00.000Z')
    const section = await screen.findByRole('region', { name: /What's new/u })
    expect(within(section).getByText('2 new')).toBeTruthy()
    expect(within(section).getAllByText('New')).toHaveLength(2)
    fireEvent.click(within(section).getByRole('button', { name: 'Mark as seen' }))
    expect(within(section).queryAllByText('New')).toEqual([])
    expect(within(section).queryByRole('button', { name: 'Mark as seen' })).toBeNull()
  })

  it('shows upstream changes as of the last fetch with the fetch command to copy', async () => {
    mount(ready)
    const upstream = await screen.findByRole('region', { name: 'main@fork-source' })
    expect(within(upstream).getByText('only upstream has this')).toBeTruthy()
    expect(upstream.textContent).toContain('not in your main, as of the last fetch')
    expect(within(upstream).getByRole('button', { name: 'Copy jj git fetch --remote fork-source' })).toBeTruthy()
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
