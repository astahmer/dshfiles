// @vitest-environment jsdom
import { PluginQueryProvider, pluginQueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LandCard } from './land-card.js'

const host = vi.hoisted(() => ({
  /** Whether jj-integration says a header Land shows for the thread; undefined: no provider. */
  // SAFETY: an upcast, undefined is a `boolean | undefined`; each case sets the flag it needs.
  headerLand: undefined as boolean | undefined,
  thread: {
    path: '/work/sample-threads/thread-31057e',
    name: 'thread-31057e',
    canRebase: true,
    behind: false,
    behindCount: 0,
    unlanded: [
      { changeId: 'kxsumpqpzxmu', commitId: 'a1', description: 'Add the changelog entry', conflict: false },
      { changeId: 'ulsmquzryowl', commitId: 'b2', description: 'Fix the refresh race', conflict: false },
    ],
  },
}))

vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useRegistry: () => [],
  useContract: () =>
    host.headerLand === undefined
      ? { status: 'inactive' }
      : { status: 'active', value: { shown: () => host.headerLand === true, subscribe: () => () => undefined } },
  useApi: () => ({
    threadStatus: async () => ({ bookmark: 'main', thread: host.thread }),
    receipts: async () => [],
    review: async () => ({ status: 'ok', files: [{ additions: 3, deletions: 0 }] }),
    repositories: async () => ({ repositories: [] }),
    landImpact: async () => ({ applies: false, reason: null }),
  }),
}))

afterEach(() => {
  host.headerLand = undefined
  cleanup()
  pluginQueryClient().clear()
})

const mount = (): void => {
  render(
    <PluginQueryProvider>
      <LandCard cwd={host.thread.path} onLanded={() => undefined} openHistory={() => undefined} sessionId="session-1" threadBusy={false} />
    </PluginQueryProvider>,
  )
}

describe('Land card preconditions', () => {
  it('says what holds in one muted line, with no chip while nothing is wrong', async () => {
    host.thread = { ...host.thread, behind: false, behindCount: 0 }
    mount()
    const facts = await screen.findByTestId('land-card-facts')
    expect(facts.textContent).toBe('2 revisions to land · up to date with main · described')
    expect(document.querySelectorAll('[data-merge-check]')).toHaveLength(0)
  })

  it('keeps a chip for the one precondition that needs the user', async () => {
    host.thread = { ...host.thread, behind: true, behindCount: 3 }
    mount()
    const facts = await screen.findByTestId('land-card-facts')
    expect(facts.textContent).toBe('2 revisions to land · described')
    expect([...document.querySelectorAll('[data-merge-check]')].map(chip => chip.getAttribute('data-merge-check'))).toEqual(['behind'])
    expect(screen.getByText('Behind main by 3')).toBeTruthy()
  })
})

describe('Land card primary', () => {
  const landButton = async (): Promise<HTMLElement> => screen.findByRole('button', { name: 'Land 2 revisions on main' })

  it('is the primary Land when no header Land shows', async () => {
    host.headerLand = false
    mount()
    expect((await landButton()).getAttribute('data-variant')).toBe('default')
  })

  it('steps back to outline while the thread header shows its own Land', async () => {
    host.headerLand = true
    mount()
    expect((await landButton()).getAttribute('data-variant')).toBe('outline')
  })
})
