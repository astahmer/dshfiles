// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PluginQueryProvider, pluginQueryClient } from '@dshfiles/plugin-ui/query'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LandResult, ThreadView } from './api.js'
import { describeLandResult } from './land-feedback.js'
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
  revisionGraph: vi.fn(),
}))

vi.mock('./use-session-thread-api.js', () => ({ useSessionThreadApi: () => api }))
vi.mock('./project-bookmark-query.js', () => ({ useProjectBookmark: (_path: string | null | undefined, fallback: string) => fallback }))
vi.mock('./revision-graph-hover-card.js', () => ({
  revisionGraphQueryKey: (path: string) => ['jj-integration', 'revision-graph', path],
  RevisionGraphHoverCard: (props: { readonly trigger: JSX.Element }) => props.trigger,
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  relativeTime: (at: number, now: number) => ({ unit: 'minutes', n: Math.round((now - at) / 60_000) }),
  Toast: (props: { readonly text: string; readonly onDone: () => void }) => (
    <div role="status" data-testid="toast">
      {props.text}
      <button onClick={props.onDone} type="button">
        dismiss toast
      </button>
    </div>
  ),
}))
vi.mock('@dshfiles/dshx/client', async original => ({ ...(await original()), useRegistry: () => [] }))

const { ThreadWorkspaceControl } = await import('./thread-workspace-control.js')
const { LandPreview } = await import('./land-preview.js')
const { IntegrationMarkerLine } = await import('./integration-marker.js')

const SESSION = 'session-land'
const PATH = '/repo-threads/thread-land'
const FULL_CHANGE_ID = 'noxmopmxyukoltvvomptosrvrzsknsxr'

const revision = { changeId: FULL_CHANGE_ID, commitId: '5aae59a6c0ffee', description: 'feat(land): phone land test', conflict: false }

const thread = (overrides: Partial<ThreadView> = {}): ThreadView => ({
  name: 'thread-land',
  path: PATH,
  workspaceId: null,
  finished: false,
  missing: false,
  behind: false,
  sessionIds: [SESSION],
  unlanded: [revision],
  ...overrides,
})

const sessions = (): ISessions => {
  const snapshot = {
    byId: {
      [SESSION]: { id: SESSION, cwd: PATH, running: false, title: 'Land thread', displayTitle: 'Land thread', projectionValues: { userQuestions: { active: [] } } },
    },
  }
  // SAFETY: the control reads only the session list's snapshot and subscription, and this snapshot holds the thread's session.
  return { list: { getSnapshot: () => snapshot, subscribe: () => () => undefined } } as never
}

const renderHeader = () =>
  render(
    <div data-conversation-session={SESSION}>
      <PluginQueryProvider>
        <ThreadWorkspaceControl
          bookmark="main"
          openThreadWorkspaces={() => undefined}
          sessionId={SessionId(SESSION)}
          sessionLog={{ current: undefined }}
          sessions={sessions()}
          t={english}
        />
      </PluginQueryProvider>
      <div data-composer-card="">
        <div aria-label="Composer" contentEditable data-composer-input="" role="textbox" suppressContentEditableWarning tabIndex={0} />
      </div>
    </div>,
  )

const landed: LandResult = {
  status: 'landed',
  bookmark: 'main',
  revisions: [revision],
  files: [],
  agentAsked: false,
  head: revision,
}

// jsdom has no ResizeObserver; the Land tooltip that opens when focus returns to Land measures with one.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  api.threadAt.mockResolvedValueOnce({ thread: thread() }).mockResolvedValue({ thread: thread({ unlanded: [], rebasedAt: Date.now() }) })
  api.land.mockResolvedValue(landed)
})

afterEach(() => {
  cleanup()
  pluginQueryClient().clear()
  vi.clearAllMocks()
  vi.resetAllMocks()
})

describe('Land from the thread header (round three item 27)', () => {
  it('confirms in the header, with no toast over it', async () => {
    renderHeader()
    fireEvent.click(await screen.findByRole('button', { name: 'Land this thread' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Land on main' }))
    await waitFor(() => expect(api.land).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(document.querySelector('[data-workspace-landed]')).not.toBeNull())
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('hands focus to the composer once the confirmed dialog closes, never to the page', async () => {
    renderHeader()
    fireEvent.click(await screen.findByRole('button', { name: 'Land this thread' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Land on main' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Composer' })))
  })

  it('returns focus to Land when the dialog is cancelled', async () => {
    api.threadAt.mockReset()
    api.threadAt.mockResolvedValue({ thread: thread() })
    renderHeader()
    const land = await screen.findByRole('button', { name: 'Land this thread' })
    fireEvent.click(land)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Land this thread' })))
  })

  it('keeps a toast for a land that stopped, worded without revision ids', async () => {
    api.land.mockResolvedValue({ status: 'needs-description', bookmark: 'main', revisions: [revision], files: [], agentAsked: false } satisfies LandResult)
    api.threadAt.mockReset()
    api.threadAt.mockResolvedValue({ thread: thread() })
    renderHeader()
    fireEvent.click(await screen.findByRole('button', { name: 'Land this thread' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Land on main' }))
    const toast = await screen.findByTestId('toast')
    expect(toast.textContent).not.toContain(FULL_CHANGE_ID.slice(0, 8))
    expect(toast.textContent).toContain('1 revision')
  })
})

describe('describeLandResult', () => {
  it('names no change id in a refusal', () => {
    const text = describeLandResult(english, {
      status: 'needs-description',
      bookmark: 'main',
      revisions: [revision, { ...revision, changeId: 'zzzzyyyyxxxx' }],
      files: [],
      agentAsked: false,
    })
    expect(text).not.toMatch(/noxmopmx|zzzzyyyy/u)
    expect(text).toContain('2 revisions')
  })
})

describe('the turn-end Land offer', () => {
  it('keeps its sentence and drops its own Land while the header shows one', () => {
    render(
      <TooltipProvider>
        <LandPreview bookmark="main" headerLandShown landing={false} onLand={() => undefined} pending={false} revisions={[revision]} t={english} />
      </TooltipProvider>,
    )
    expect(screen.getByTestId('jj-inline-integrate-offer').textContent).toContain('main')
    expect(screen.queryByRole('button', { name: 'Land on main' })).toBeNull()
  })

  it('offers Land when no header Land is on screen', () => {
    render(
      <TooltipProvider>
        <LandPreview bookmark="main" headerLandShown={false} landing={false} onLand={() => undefined} pending={false} revisions={[revision]} t={english} />
      </TooltipProvider>,
    )
    expect(screen.getByRole('button', { name: 'Land on main' })).not.toBeNull()
  })
})

describe('the transcript Land marker', () => {
  it('is one line: where it landed and when, with the short id only in its tooltip', () => {
    const now = Date.UTC(2026, 10, 24, 18, 20)
    render(
      <TooltipProvider>
        <IntegrationMarkerLine at={now - 5 * 60_000} bookmark="main" now={now} t={english} tipChangeId={FULL_CHANGE_ID} />
      </TooltipProvider>,
    )
    const marker = screen.getByTestId('jj-integration-marker-text')
    expect(marker.textContent).toBe('Landed on main')
    expect(marker.className).toContain('dshx:truncate')
    expect(document.body.textContent).not.toContain(FULL_CHANGE_ID)
    expect(screen.getByText('5m ago')).not.toBeNull()
  })
})
