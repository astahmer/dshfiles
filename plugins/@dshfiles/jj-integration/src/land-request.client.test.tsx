// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PluginQueryProvider, pluginQueryClient } from '@dshfiles/plugin-ui/query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadView } from './api.js'
import { createLandRequests } from './land-requests.js'
import type { JjIntegrationTranslate } from './locales.js'

/** The English strings as written (the locale object is only readable through the Host), interpolated like it. */
const english: JjIntegrationTranslate = (() => {
  const source = readFileSync(join(import.meta.dirname, 'locales.ts'), 'utf8')
  const block = source.slice(source.indexOf('const en = {'), source.indexOf('const zh = {'))
  const entries = new Map<string, string>()
  for (const match of block.matchAll(/^ {2}(\w+):\s*\n?\s*'((?:[^'\\]|\\.)*)',$/gmu)) entries.set(match[1] ?? '', match[2] ?? '')
  const translate = (key: string, values?: Readonly<Record<string, string | number>>): string =>
    (entries.get(key) ?? key).replace(/\{(\w+)\}/gu, (_whole, name: string) => String(values?.[name] ?? `{${name}}`))
  // SAFETY: the table holds every English entry of locales.ts, and a key it lacks prints itself, as the Host's does.
  return translate as JjIntegrationTranslate
})()

const api = vi.hoisted(() => ({
  threadAt: vi.fn(),
  land: vi.fn(),
  queueLand: vi.fn(),
  cancelQueuedLand: vi.fn(),
}))

vi.mock('./use-session-thread-api.js', () => ({ useSessionThreadApi: () => api }))
vi.mock('./project-bookmark-query.js', () => ({ useProjectBookmark: (_path: string | null | undefined, fallback: string) => fallback }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Toast: (props: { readonly text: string; readonly onDone: () => void }) => (
    <div role="status">
      {props.text}
      <button onClick={props.onDone} type="button">
        dismiss toast
      </button>
    </div>
  ),
}))
vi.mock('@dshfiles/dshx/client', async original => ({ ...(await original()), useRegistry: () => [] }))

const { ThreadWorkspaceControl } = await import('./thread-workspace-control.js')

const SESSION = 'session-row'
const PATH = '/repo-threads/thread-row'

const thread = (overrides: Partial<ThreadView> = {}): ThreadView => ({
  name: 'thread-row',
  path: PATH,
  workspaceId: null,
  finished: false,
  missing: false,
  behind: false,
  sessionIds: [SESSION],
  unlanded: [{ changeId: 'kxyzabcd1234', commitId: 'c0ffee12', description: 'feat(row): land me', conflict: false }],
  ...overrides,
})

const sessions = (running = false): ISessions => {
  // One snapshot object: the control reads it through useSyncExternalStore, which compares by identity.
  const snapshot = {
    byId: {
      [SESSION]: { id: SESSION, cwd: PATH, running, title: 'Row thread', displayTitle: 'Row thread', projectionValues: { userQuestions: { active: [] } } },
    },
  }
  // SAFETY: the control reads only the session list's snapshot and subscription, and this snapshot holds the row's session.
  return { list: { getSnapshot: () => snapshot, subscribe: () => () => undefined } } as never
}

const renderRequest = (options: { readonly running?: boolean; readonly onDone?: () => void } = {}) =>
  render(
    <PluginQueryProvider>
      <ThreadWorkspaceControl
        bookmark="main"
        onRequestDone={options.onDone}
        openThreadWorkspaces={() => undefined}
        seat="request"
        sessionId={SessionId(SESSION)}
        sessionLog={{ current: undefined }}
        sessions={sessions(options.running)}
        t={english}
      />
    </PluginQueryProvider>,
  )

beforeEach(() => {
  api.threadAt.mockResolvedValue({ thread: thread() })
  api.land.mockResolvedValue({
    status: 'landed',
    bookmark: 'main',
    revisions: [{ changeId: 'kxyzabcd1234', commitId: 'c0ffee12', description: 'feat(row): land me' }],
  })
})

afterEach(() => {
  cleanup()
  pluginQueryClient().clear()
  vi.clearAllMocks()
})

describe('a Land asked for from another view (ThreadHeaderLand.confirm)', () => {
  it('opens the header confirmation with the revisions that move and lands only on its confirm', async () => {
    const onDone = vi.fn()
    renderRequest({ onDone })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Land 1 revision on main?')
    expect(screen.getByTestId('workspace-land-preview').textContent).toContain('feat(row): land me')
    expect(api.land).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Land on main' }))
    await waitFor(() => expect(api.land).toHaveBeenCalledTimes(1))
    expect(api.land.mock.calls[0]?.[0]).toEqual({ path: PATH, sessionId: SESSION })
    // The request stays mounted until the land is reported, then ends.
    const report = await screen.findByRole('status')
    expect(report.textContent).toContain('main')
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'dismiss toast' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('Cancel lands nothing and ends the request', async () => {
    const onDone = vi.fn()
    renderRequest({ onDone })
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(api.land).not.toHaveBeenCalled()
  })

  it('keeps the header guards: a busy workspace gets the reason, never the dialog', async () => {
    const onDone = vi.fn()
    renderRequest({ running: true, onDone })
    const reason = await screen.findByRole('status')
    expect(reason.textContent).toContain('still in use')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.land).not.toHaveBeenCalled()
  })

  it('keeps the header guards: an undescribed revision gets the reason, never the dialog', async () => {
    api.threadAt.mockResolvedValue({ thread: thread({ unlanded: [{ changeId: 'kundescribed', commitId: 'c1', description: '', conflict: false }] }) })
    renderRequest()
    const reason = await screen.findByRole('status')
    expect(reason.textContent).toContain('kundescr')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.land).not.toHaveBeenCalled()
  })
})

describe('land requests', () => {
  it('a newer request replaces the one on screen; finishing an older one leaves it', () => {
    const requests = createLandRequests()
    const listener = vi.fn()
    requests.subscribe(listener)
    requests.request('a')
    const first = requests.current()
    requests.request('a')
    const second = requests.current()
    expect(second?.sequence).not.toBe(first?.sequence)
    act(() => requests.finish(first?.sequence ?? -1))
    expect(requests.current()).toEqual(second)
    requests.finish(second?.sequence ?? -1)
    expect(requests.current()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
