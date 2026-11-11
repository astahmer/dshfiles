// @vitest-environment jsdom
import { PluginQueryProvider, pluginQueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { SuggestionsModel, type Suggestions } from './suggestions-model.js'
import { SuggestionsSection } from './suggestions-section.js'
import type { FeaturedDay } from './suggestions-window.js'

afterEach(() => {
  cleanup()
  pluginQueryClient().clear()
})

const ready: Suggestions = {
  state: 'ready',
  days: 30,
  suggestions: SuggestionsModel.suggest({
    catalog: FEATURE_CATALOG,
    signals: {
      tools: new Map([['todo_write', 40]]),
      commands: new Map([['jj', 30]]),
      toolErrors: 0,
      turns: 0,
      longestThreadRequests: 0,
      compactionRequests: 0,
    },
  }),
}

/** The section with browser-local state held the way the stores hold it. */
const Harness = (props: { readonly enabled: boolean; readonly value: Suggestions; readonly load: () => void; readonly showWhere: (key: string) => void }) => {
  const [featured, setFeatured] = useState<FeaturedDay | null>(null)
  const [dismissed, setDismissed] = useState<readonly string[]>([])
  return (
    <PluginQueryProvider>
      <SuggestionsSection
        dismiss={rule => setDismissed([...dismissed, rule])}
        dismissed={dismissed}
        enabled={props.enabled}
        featured={featured}
        findFeature={() => undefined}
        loadSuggestions={async () => {
          props.load()
          return props.value
        }}
        openSetting={() => undefined}
        remember={setFeatured}
        restoreDismissed={() => setDismissed([])}
        showWhere={props.showWhere}
        today="2026-11-11"
      />
    </PluginQueryProvider>
  )
}

describe('SuggestionsSection', () => {
  it('reads nothing while off and offers the setting', () => {
    const load = vi.fn()
    render(<Harness enabled={false} load={load} showWhere={() => undefined} value={ready} />)
    const section = screen.getByRole('region', { name: /^Suggestions/u })
    expect(section.getAttribute('data-suggestions')).toBe('off')
    expect(within(section).getByRole('button', { name: 'Turn on in Settings' })).toBeTruthy()
    expect(load).not.toHaveBeenCalled()
  })

  it('features one suggestion, lists the rest behind Show all, and dismisses for good with a way back', async () => {
    const showWhere = vi.fn()
    render(<Harness enabled load={() => undefined} showWhere={showWhere} value={ready} />)
    const featured = await screen.findByRole('list', { name: 'Suggestion of the day' })
    expect(featured.querySelector('[data-suggestion]')?.getAttribute('data-suggestion')).toBe('jj-without-thread-workspaces')
    fireEvent.click(within(featured).getByRole('button', { name: 'Show me where: New thread destination and workspace isolation' }))
    expect(showWhere).toHaveBeenCalledWith('jj-integration#thread-destination')

    expect(screen.queryByRole('list', { name: 'Other suggestions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all suggestions (1)' }))
    const others = screen.getByRole('list', { name: 'Other suggestions' })
    expect(others.querySelector('[data-suggestion]')?.getAttribute('data-suggestion')).toBe('plans-without-backlog')

    fireEvent.click(within(featured).getByRole('button', { name: 'Dismiss: New thread destination and workspace isolation' }))
    expect(screen.queryByRole('list', { name: 'Suggestion of the day' })).toBeNull()
    expect(document.querySelector('[data-suggestion="jj-without-thread-workspaces"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restore 1 dismissed' }))
    expect(screen.getByRole('list', { name: 'Suggestion of the day' }).querySelector('[data-suggestion]')?.getAttribute('data-suggestion')).toBe(
      'jj-without-thread-workspaces',
    )
  })

  it('says honestly when there is nothing to suggest, or why it cannot read usage', async () => {
    render(<Harness enabled load={() => undefined} showWhere={() => undefined} value={{ state: 'ready', days: 30, suggestions: [] }} />)
    expect((await screen.findByText(/Nothing in the last 30 days of tool use/u)).closest('[data-suggestions]')?.getAttribute('data-suggestions')).toBe('ready')
    cleanup()
    pluginQueryClient().clear()
    render(<Harness enabled load={() => undefined} showWhere={() => undefined} value={{ state: 'no-usage', reason: 'Usage is not running.' }} />)
    const section = await screen.findByText('Usage is not running.')
    expect(section.closest('[data-suggestions]')?.getAttribute('data-suggestions')).toBe('no-usage')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
