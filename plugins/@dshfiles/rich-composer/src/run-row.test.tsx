// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createEditor } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { ComposerBarProps } from './native/contract/slots.ts'
import type { InputState } from './native/contract/input.ts'
import { InputBar } from './native/skeleton/InputBar.tsx'

// The run row is plain composition inside the real InputBar: the presentation kit is not under test.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconPlusOutlineMedium: () => null,
  IconWarningOutlineRegular: () => null,
  Tooltip: (props: { children: ReactNode }) => props.children,
  Toast: () => null,
  useAnchoredPosition: () => ({}),
  useDismissOnOutsidePointer: () => undefined,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const selected =
  <T,>(value: T): SnapshotSelectorHook<T> =>
  selector =>
    selector(value)
const dispose: Array<() => void> = []
afterEach(() => {
  for (const release of dispose.splice(0).reverse()) release()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const barProps = (overrides: Partial<ComposerBarProps>, queue: InputState['queue'] = []): ComposerBarProps => {
  const sessionId = SessionId('run-row')
  const editor = createEditor({
    namespace: 'run-row',
    onError: error => {
      throw error
    },
  })
  const session: SessionSnapshot = {
    sessionId,
    pendingSubmissions: [],
    running: false,
    subagent: null,
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: true,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  }
  const input: InputState = { draft: '', attachmentIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue }
  // SAFETY: the bar renders only the paths these tests exercise, which read the props listed here; the global
  // standard props the composition root also supplies (sessions, remote access, …) are never read by InputBar's run row.
  return {
    sessionId,
    useSession: selected(session),
    useInput: selected(input),
    useProjection: vi.fn().mockImplementation((_key, selector) => selector?.(undefined)),
    inputActions: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }),
      insertText: () => true,
      setDraft: vi.fn(),
      persistDraft: vi.fn(),
      addAttachments: () => true,
      removeAttachment: vi.fn(),
      pruneAttachments: vi.fn(),
      submit: vi.fn(),
    },
    keyboard: {
      editor,
      snapshot: input,
      submit: vi.fn(),
      steerQueue: vi.fn(),
      paste: vi.fn(),
      caretSpan: () => ({ start: 0, end: 0 }),
      arbitrate: () => 'pass',
      space: () => false,
      dismissPopup: vi.fn(),
      bindFilePicker: () => () => undefined,
    },
    variant: 'hero',
    addFiles: vi.fn(),
    removeAttachment: vi.fn(),
    resolveDraftAttachments: () => [],
    retryFileUpload: vi.fn(),
    promptHistory: () => [],
    toggleCommandMenu: vi.fn(),
    stop: vi.fn(),
    insertReference: vi.fn(),
    useBusyEnter: selected('queue'),
    useFileUploads: selected({}),
    useNotices: selected(null),
    useLexicon: vi.fn(),
    useMenuLauncher: selected(null),
    useStopShortcut: selected([]),
    // Each seat renders a marker so the test can see where the bar placed it.
    // SAFETY: InputBar only calls renderSlot(key, owner) and renders the node it returns; a marker per key needs no owner props.
    renderSlot: ((name: string) => <i data-seat={name} />) as ComposerBarProps['renderSlot'],
    SessionProvider: props => props.children,
    // SAFETY: the bar only translates the keys it renders here; this stub echoes the key or the queued count.
    t: ((key: string, params?: Record<string, string>) => (params?.count === undefined ? key : `${params.count} queued`)) as ComposerBarProps['t'],
    ...overrides,
  } as ComposerBarProps
}

const mount = (props: ComposerBarProps): HTMLElement => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  dispose.push(() => act(() => root.unmount()))
  act(() => root.render(<InputBar {...props} />))
  return element
}

describe('composer run row', () => {
  it('holds every pre-send choice in one row above the card on a new thread', () => {
    const element = mount(barProps({ runRow: <span data-run-segment="project">sample</span> }))
    const row = element.querySelector('[data-run-row]')
    expect(row?.getAttribute('role')).toBe('group')
    expect(row?.querySelector('[data-run-segment="project"]')?.textContent).toBe('sample')
    expect(row?.querySelector('[data-run-segment="file-access"] [data-seat="conversation.input.permission"]')).not.toBeNull()
    expect(row?.querySelector('[data-run-segment="model"] [data-seat="conversation.input.model"]')).not.toBeNull()
    // Moved, not duplicated: the toolbar no longer carries the two seats.
    expect(element.querySelectorAll('[data-seat="conversation.input.model"]')).toHaveLength(1)
    expect(element.querySelectorAll('[data-seat="conversation.input.permission"]')).toHaveLength(1)
  })

  it('collapses to a summary chip on the meter line once the thread has started', () => {
    const queued = (id: string): InputState['queue'][number] => ({
      id: MessageId(id),
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: id }],
    })
    const queue: InputState['queue'] = [queued('q1'), queued('q2')]
    const element = mount(barProps({ variant: 'composer', runSummary: <span data-run-summary="">sample · Local</span> }, queue))
    expect(element.querySelector('[data-run-row]')).toBeNull()
    const meter = element.querySelector('[data-meter-line]')
    expect(meter?.firstElementChild?.getAttribute('data-run-summary')).toBe('')
    expect(meter?.querySelector('[data-meter="queued"]')?.textContent).toBe('2 queued')
    expect(meter?.querySelector('[data-seat="conversation.composer.dock"]')).not.toBeNull()
    // The started thread keeps model and file access changeable in the toolbar.
    expect(element.querySelector('[data-composer-card] [data-seat="conversation.input.model"]')).not.toBeNull()
    expect(element.querySelector('[data-composer-card] [data-seat="conversation.input.permission"]')).not.toBeNull()
  })
})
