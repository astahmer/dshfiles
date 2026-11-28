// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { PluginQueryProvider, pluginQueryClient } from '@dshfiles/plugin-ui/query'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** What the Host reads for the Session's folder: three changed files against main, whoever changed them. */
const repository = (workspace: string) => ({
  root: workspace === 'default' ? '/work/sample' : '/work/sample-threads/' + workspace,
  workspace,
  changeId: 'kxsumpqp',
  commitId: '0123456789ab',
  description: '',
  empty: false,
  conflict: host.conflict,
  bookmarks: [],
  nearestBookmarks: host.nearestBookmarks,
  base: { label: 'main', found: true },
  revisionCounts: host.revisionCounts,
  totals: { files: 3, additions: 21, deletions: 0 },
  files: [],
  filesTruncated: false,
  localBookmarks: ['main'],
  remoteBookmarks: [],
})

const host = vi.hoisted(() => ({
  workspace: 'default',
  totals: { files: 3, additions: 21, deletions: 0 },
  reads: 0,
  // The repository's state a test may change (behind, conflict, no bookmark).
  conflict: false,
  nearestBookmarks: ['main'],
  revisionCounts: { ahead: 1, behind: 0 },
}))

// The native package pulls its icon set at import; the pill needs none of it.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ ReferenceChip: () => null }))
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useSettings: () => ({ value: {} }),
  // jj-integration's `destination`: the folder's owning project.
  useApi: () => ({ destination: async () => ({ projectWorkspaceId: 'workspace-project' }) }),
}))
vi.mock('@dshfiles/jj-integration/project-bookmark', () => ({ useProjectBookmark: () => 'main' }))
vi.mock('./use-jujutsu-api.js', () => ({
  useComposerContextApi: () => ({
    context: async () => {
      host.reads += 1
      return { repository: { ...repository(host.workspace), totals: host.totals } }
    },
  }),
}))
vi.mock('./auto-refresh.js', () => ({ useAutoRefresh: () => ({ ref: () => undefined, queryOptions: {} }) }))

import { ChangesPill, ComposerChips, ProjectChangesSection, type ComposerJujutsuServices } from './composer-context.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const store = <Snapshot,>(snapshot: Snapshot): never =>
  // SAFETY: the pill reads only a list store's snapshot and subscription, and this fake carries both.
  ({ list: { subscribe: () => () => undefined, getSnapshot: () => snapshot } }) as never

const services = (cwd: string, review: ComposerJujutsuServices['openWorkspaceReview']): ComposerJujutsuServices => ({
  sessions: store({ byId: { 'session-1': { id: 'session-1', cwd, blank: false } } }),
  workspaces: store({
    items: [
      { workspaceId: 'workspace-project', title: 'sample', path: '/work/sample', sessionIds: cwd === '/work/sample' ? ['session-1'] : [] },
      {
        workspaceId: 'workspace-thread',
        title: 'thread-31057e',
        path: '/work/sample-threads/thread-31057e',
        sessionIds: cwd === '/work/sample' ? [] : ['session-1'],
      },
    ],
  }),
  toggleJujutsu: () => undefined,
  openWorkspaceReview: review,
  openJujutsuReference: () => undefined,
})

let root: Root | undefined
let container: HTMLElement | undefined

const mount = async (element: JSX.Element): Promise<HTMLElement> => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(PluginQueryProvider, null, element))
  })
  // The context read, then the project read it enables.
  for (let turn = 0; turn < 5; turn += 1) await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  pluginQueryClient().clear()
  host.workspace = 'default'
  host.totals = { files: 3, additions: 21, deletions: 0 }
  host.reads = 0
  host.conflict = false
  host.nearestBookmarks = ['main']
  host.revisionCounts = { ahead: 1, behind: 0 }
})

describe('Changes pill', () => {
  it('claims no diff for a thread that works in the project checkout', async () => {
    host.workspace = 'default'
    const view = await mount(<ChangesPill sessionId={'session-1' as never} jujutsu={services('/work/sample', () => true)} />)
    expect(view.querySelector('[data-changes-pill]')).toBeNull()
    expect(view.textContent).not.toContain('+21')
  })

  it('shows what a thread changed in its own workspace', async () => {
    host.workspace = 'thread-31057e'
    const view = await mount(<ChangesPill sessionId={'session-1' as never} jujutsu={services('/work/sample-threads/thread-31057e', () => true)} />)
    const pill = view.querySelector('[data-changes-pill]')
    expect(pill?.textContent).toBe('+21−0')
    expect(pill?.getAttribute('aria-label')).toBe('Review workspace changes: @ vs main: 1 only on @')
  })

  it('takes no header seat when its own workspace changed nothing', async () => {
    host.workspace = 'thread-31057e'
    host.totals = { files: 0, additions: 0, deletions: 0 }
    const view = await mount(<ChangesPill sessionId={'session-1' as never} jujutsu={services('/work/sample-threads/thread-31057e', () => true)} />)
    expect(view.querySelector('[data-changes-pill]')).toBeNull()
    expect(view.textContent).not.toContain('No changes')
  })
})

describe('Project changes row of the workspace menu', () => {
  it('states the checkout diff as the project’s and opens the Changes view', async () => {
    host.workspace = 'default'
    const review = vi.fn(() => true)
    const dismiss = vi.fn()
    const view = await mount(<ProjectChangesSection dismiss={dismiss} sessionId={'session-1' as never} jujutsu={services('/work/sample', review)} />)
    expect(view.textContent).toContain('The project has changes that are not on main: 3 files, +21 −0. They can come from any thread working here.')
    const button = view.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Review project changes: @ vs main: 1 only on @')
    act(() => button?.click())
    expect(dismiss).toHaveBeenCalledOnce()
    expect(review).toHaveBeenCalledWith('/work/sample', 'session-1')
  })

  it('says nothing in a thread’s own workspace, where the pill does', async () => {
    host.workspace = 'thread-31057e'
    const view = await mount(
      <ProjectChangesSection dismiss={() => undefined} sessionId={'session-1' as never} jujutsu={services('/work/sample-threads/thread-31057e', () => true)} />,
    )
    expect(view.querySelector('[data-project-changes]')).toBeNull()
  })
})

describe('Location chip on the meter line', () => {
  it('leaves the land count of an own workspace to the header', async () => {
    host.workspace = 'thread-31057e'
    const view = await mount(<ComposerChips sessionId={'session-1' as never} jujutsu={services('/work/sample-threads/thread-31057e', () => true)} />)
    expect(view.querySelector('[data-composer-meta="location"]')?.textContent).toBe('Own workspace')
  })

  it('still says where the project checkout stands', async () => {
    host.workspace = 'default'
    const view = await mount(<ComposerChips sessionId={'session-1' as never} jujutsu={services('/work/sample', () => true)} />)
    expect(view.querySelector('[data-composer-meta="location"]')?.textContent).toBe('In the project · 1 ahead of main')
  })

  // Council round 13 C5: a phone hides the passive meter line; the chip flags the states it must still show.
  it('flags no alert while the checkout only stands ahead of its bookmark', async () => {
    const view = await mount(<ComposerChips sessionId={'session-1' as never} jujutsu={services('/work/sample', () => true)} />)
    expect(view.querySelector('[data-composer-meta="location"]')?.hasAttribute('data-meter-alert')).toBe(false)
  })

  it.each([
    ['behind', (): void => {
      host.revisionCounts = { ahead: 1, behind: 2 }
    }],
    ['conflict', (): void => {
      host.conflict = true
    }],
    ['detached', (): void => {
      host.nearestBookmarks = []
    }],
  ] as const)('flags %s as an alert the meter line keeps on a phone', async (state, arrange) => {
    arrange()
    const view = await mount(<ComposerChips sessionId={'session-1' as never} jujutsu={services('/work/sample', () => true)} />)
    expect(view.querySelector('[data-composer-meta="location"]')?.getAttribute('data-meter-alert')).toBe(state)
  })
})

describe('Changes pill at the end of a turn', () => {
  it('reads the workspace again when the turn ends, so new changes show without waiting for the poll', async () => {
    host.workspace = 'thread-31057e'
    host.totals = { files: 0, additions: 0, deletions: 0 }
    const base = services('/work/sample-threads/thread-31057e', () => true)
    const listeners = new Set<() => void>()
    let byId = { 'session-1': { id: 'session-1', cwd: '/work/sample-threads/thread-31057e', blank: false, running: true } }
    const sessions = {
      list: { subscribe: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)), getSnapshot: () => ({ byId }) },
    }
    const view = await mount(<ChangesPill sessionId={'session-1' as never} jujutsu={{ ...base, sessions } as never} />)
    expect(view.querySelector('[data-changes-pill]')).toBeNull()
    const readsWhileRunning = host.reads

    // The agent wrote a file and its turn ended.
    host.totals = { files: 1, additions: 4, deletions: 0 }
    byId = { 'session-1': { ...byId['session-1'], running: false } }
    await act(async () => {
      for (const listener of listeners) listener()
    })
    for (let turn = 0; turn < 5; turn += 1) await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))))
    expect(host.reads).toBeGreaterThan(readsWhileRunning)
    expect(view.querySelector('[data-changes-pill]')?.textContent).toBe('+4−0')
  })
})
