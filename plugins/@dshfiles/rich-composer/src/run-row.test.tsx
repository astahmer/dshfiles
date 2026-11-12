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
import { DraftAnnotations } from './native/input/draft-annotations.ts'

// The run row is plain composition inside the real InputBar: the presentation kit is not under test.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  focusWithoutRing: () => undefined,
  HoverCardGroup: (props: { children: ReactNode }) => props.children,
  IconPlusOutlineMedium: () => null,
  IconTriangleRightFillRegular: () => null,
  isMobileDevice: () => false,
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
  vi.restoreAllMocks()
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
    historyWasPartial: false,
    historyLoadStatus: 'idle',
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
      annotations: new DraftAnnotations(),
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
    retry: undefined,
    registerFileIntake: () => () => undefined,
    occurrence: 'main',
    useAccess: () => true,
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
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        void callback
      }
      observe() {}
      unobserve() {}
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
  it('holds every pre-send choice inside the card, after the + control, on a new thread', () => {
    const element = mount(barProps({ runRow: <span data-run-segment="project">sample</span> }))
    const card = element.querySelector('[data-composer-card]')
    const row = card?.querySelector('[data-run-row]')
    expect(row?.getAttribute('role')).toBe('group')
    expect(row?.querySelector('[data-run-segment="project"]')?.textContent).toBe('sample')
    expect(row?.querySelector('[data-run-segment="file-access"] [data-seat="conversation.input.permission"]')).not.toBeNull()
    // Nothing above the input: the card is the first thing the bar draws.
    expect(element.firstElementChild?.querySelector('[data-run-row]')).toBe(row)
    expect(element.querySelector(':scope > div > [data-run-row]')).toBeNull()
    // Moved, not duplicated: one file-access seat and one model seat, the model beside Send.
    expect(element.querySelectorAll('[data-seat="conversation.input.model"]')).toHaveLength(1)
    expect(element.querySelectorAll('[data-seat="conversation.input.permission"]')).toHaveLength(1)
    const model = card?.querySelector('[data-model-seat][data-run-segment="model"] [data-seat="conversation.input.model"]')
    expect(model).not.toBeNull()
    const send = card?.querySelector('button[aria-label="input.send"]')
    if (send === null || send === undefined) throw new Error('the card has no Send button')
    // Document order: the model seat comes before Send in the same trailing group.
    expect(model?.compareDocumentPosition(send)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
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

describe('send button states (visual refresh T3.3)', () => {
  const sendState = (options: { readonly running: boolean; readonly draft: string; readonly busyEnter: 'queue' | 'steer' }) => {
    const base = barProps({ variant: 'composer' })
    const session = base.useSession(snapshot => snapshot)
    const input = base.useInput(snapshot => snapshot)
    if (session === undefined || input === undefined) throw new Error('fixture lacks a session')
    const element = mount({
      ...base,
      useSession: selected({ ...session, running: options.running, blank: false }),
      useInput: selected({ ...input, draft: options.draft }),
      useBusyEnter: selected(options.busyEnter),
    })
    const button = element.querySelector<HTMLButtonElement>('[data-composer-card] button[data-send-mode]')
    return { mode: button?.dataset.sendMode, label: button?.getAttribute('aria-label'), disabled: button?.disabled }
  }

  it('sends an idle draft, and dims while the draft is empty', () => {
    expect(sendState({ running: false, draft: 'hello', busyEnter: 'queue' })).toEqual({ mode: 'send', label: 'input.send', disabled: false })
    expect(sendState({ running: false, draft: '', busyEnter: 'queue' })).toEqual({ mode: 'send', label: 'input.send', disabled: true })
  })

  it('queues or steers a draft into a running turn, as Enter would', () => {
    expect(sendState({ running: true, draft: 'also this', busyEnter: 'queue' })).toEqual({ mode: 'queue', label: 'input.send.queue', disabled: false })
    expect(sendState({ running: true, draft: 'also this', busyEnter: 'steer' })).toEqual({ mode: 'steer', label: 'input.send.steer', disabled: false })
  })

  it('stops a running turn while the draft is empty', () => {
    expect(sendState({ running: true, draft: '', busyEnter: 'queue' })).toEqual({ mode: 'stop', label: 'input.stop', disabled: false })
  })
})
