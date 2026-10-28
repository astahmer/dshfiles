// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createEditor } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { ComposerBarProps, ConversationContentProps, ConversationSessionHeaderSlotProps, ConversationSessionSlotProps } from './native/contract/slots.ts'
import { ConversationSessionHeader } from './native/skeleton/ConversationSession.tsx'
import type { InputState } from './native/contract/input.ts'
import { EMPTY_CONVERSATION_SNAPSHOT } from './native/contract/snapshot.ts'
import { ConversationContent } from './native/skeleton/ConversationContent.tsx'
import { DefaultConversationViews } from './native/skeleton/DefaultConversationViews.tsx'
import { InputBar } from './native/skeleton/InputBar.tsx'

// The presentation-only Host kit is not the boundary under test. Keep the real
// Content factory body, Session view selection, InputBar, and Lexical binding.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  FISH_LOGO_PATH: '',
  FISH_LOGO_VIEWBOX: '',
  IconChevronDownOutlineRegular: () => null,
  IconFolderCloseRegular: () => null,
  IconFolderOpenRegular: () => null,
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

const fixture = (id: string, initialView = 'chat') => {
  const sessionId = SessionId(id)
  const editor = createEditor({
    namespace: id,
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
    blank: false,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  }
  const input: InputState = {
    draft: '',
    attachmentIds: [],
    draftRev: 0,
    phase: 'plain',
    occurrences: [],
    queue: [],
  }
  const shared = {
    sessionId,
    useSession: selected(session),
    useInput: selected(input),
    useChat: vi.fn(),
    useConversation: selected(EMPTY_CONVERSATION_SNAPSHOT),
    useSessions: selected({
      ids: [sessionId],
      byId: { [sessionId]: { id: sessionId, displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: 0 } },
      phase: 'ready' as const,
      projectionsBySession: {},
    }),
    useSessionStatus: selected(new Map()),
    useSessionRetainInfo: vi.fn(),
    useSessionAccess: () => true,
    useRemoteAccess: vi.fn(),
    useAccess: () => true,
    useProjection: vi.fn().mockImplementation((_key, selector) => selector?.(undefined)),
    useWorkspaces: selected({ phase: 'ready' as const, items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle' as const, error: null }),
    usePanelInfo: vi.fn(),
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
    renderFactorySlot: vi.fn(),
    t: (key: string) => key,
  }
  const viewState = { draft: '', view: initialView, viewRequest: null }
  const viewProps: ConversationSessionSlotProps = {
    ...shared,
    useConversationViews: selected([
      { id: 'chat', label: 'Chat' },
      { id: 'other', label: 'Other' },
    ]),
    // Fixed Session identity does not fix its child view to Chat.
    useStore: selected(viewState),
    actions: { setDraft: vi.fn(), setView: vi.fn(), openView: vi.fn(), completeViewRequest: vi.fn() },
    useInspectCall: selected(undefined),
    bindDraftPersistence: () => () => undefined,
    openView: vi.fn(),
    renderSlot: (_name, _owner, options) => <output data-chat-session={sessionId}>{options?.only}</output>,
    SessionProvider: props => props.children,
  }
  const barProps: ComposerBarProps = {
    ...shared,
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
    variant: 'composer',
    addFiles: vi.fn(),
    removeAttachment: vi.fn(),
    resolveDraftAttachments: () => [],
    retryFileUpload: vi.fn(),
    toggleCommandMenu: vi.fn(),
    stop: vi.fn(),
    insertReference: vi.fn(),
    useBusyEnter: selected('queue'),
    useFileUploads: selected({}),
    useNotices: selected(null),
    useLexicon: vi.fn(),
    useMenuLauncher: selected(null),
    useStopShortcut: selected([]),
    renderSlot: vi.fn(),
    SessionProvider: props => props.children,
  }
  const FixedViews = () => <DefaultConversationViews {...viewProps} />
  const NoWidthControls = () => null
  const props: ConversationContentProps = {
    ...shared,
    variant: 'embedded',
    phase: 'active',
    hero: false,
    useComposerBlock: selected(undefined),
    useDraftWorkspace: selected(undefined),
    useRemoteWorkspace: selected(undefined),
    selectWorkspace: async () => undefined,
    resolveRemoteWorkspace: async () => undefined,
    // This is the official public local-Views composition: the Content body
    // owns the composer independently of its caller-selected Session view.
    useFactorySlot: name => (name === 'views' ? FixedViews : NoWidthControls),
    renderSlot: name => {
      if (name === 'conversation.composer.bar') return <InputBar {...barProps} />
      return null
    },
    renderSlotChain: (_name, _owner, options) => options?.fallback,
    SessionProvider: provider => provider.children,
  }
  const header: ConversationSessionHeaderSlotProps = {
    ...shared,
    hideChrome: false,
    useConversationViews: viewProps.useConversationViews,
    useStore: viewProps.useStore,
    actions: viewProps.actions,
    open: vi.fn(),
    rename: vi.fn(async () => undefined),
    selectView: view => {
      viewState.view = view
    },
    renderSlot: vi.fn(() => null),
    SessionProvider: provider => provider.children,
  }
  return { props, editor, header }
}

describe('fixed Conversation content factory composition', () => {
  it('contains exactly one real chat and InputBar per bound Session, independently of global selected view', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
    const a = fixture('fixed-a')
    const b = fixture('fixed-b')
    const element = document.createElement('div')
    document.body.append(element)
    const root = createRoot(element)
    dispose.push(() => act(() => root.unmount()))
    act(() =>
      root.render(
        <>
          <ConversationContent {...a.props} />
          <ConversationContent {...b.props} />
        </>,
      ),
    )
    const contentA = element.querySelector('[data-conversation-session="fixed-a"]')
    const contentB = element.querySelector('[data-conversation-session="fixed-b"]')
    expect(contentA?.querySelector('[data-chat-session="fixed-a"]')?.textContent).toBe('chat')
    expect(contentB?.querySelector('[data-chat-session="fixed-b"]')?.textContent).toBe('chat')
    expect(contentA?.querySelectorAll('[data-composer-input]')).toHaveLength(1)
    expect(contentB?.querySelectorAll('[data-composer-input]')).toHaveLength(1)
    expect(a.editor.getRootElement()).toBe(contentA?.querySelector('[data-composer-input]'))
    expect(b.editor.getRootElement()).toBe(contentB?.querySelector('[data-composer-input]'))
    expect(a.editor.getRootElement()).not.toBe(b.editor.getRootElement())
    expect(a.props.inputActions?.persistDraft).toHaveBeenCalledTimes(1)
    expect(b.props.inputActions?.persistDraft).toHaveBeenCalledTimes(1)
  })

  it('selects native child views independently in two fixed Sessions without replacing either editor', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
    const a = fixture('view-a')
    const b = fixture('view-b', 'other')
    const element = document.createElement('div')
    document.body.append(element)
    const root = createRoot(element)
    dispose.push(() => act(() => root.unmount()))
    const draw = () =>
      root.render(
        <>
          <section data-bound-session="view-a">
            <ConversationSessionHeader {...a.header} />
            <ConversationContent {...a.props} />
          </section>
          <section data-bound-session="view-b">
            <ConversationSessionHeader {...b.header} />
            <ConversationContent {...b.props} />
          </section>
        </>,
      )
    act(draw)
    const editorA = a.editor.getRootElement()
    const editorB = b.editor.getRootElement()
    expect(element.querySelector('[data-chat-session="view-a"]')?.textContent).toBe('chat')
    expect(element.querySelector('[data-chat-session="view-b"]')?.textContent).toBe('other')
    const otherA = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-bound-session="view-a"] [role="tab"]')).find(
      tab => tab.textContent === 'Other',
    )
    expect(otherA).toBeDefined()
    act(() => {
      otherA?.click()
      draw()
    })
    expect(element.querySelector('[data-chat-session="view-a"]')?.textContent).toBe('other')
    expect(element.querySelector('[data-chat-session="view-b"]')?.textContent).toBe('other')
    expect(otherA?.getAttribute('aria-selected')).toBe('true')
    const chatB = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-bound-session="view-b"] [role="tab"]')).find(tab => tab.textContent === 'Chat')
    expect(chatB).toBeDefined()
    act(() => {
      chatB?.click()
      draw()
    })
    expect(element.querySelector('[data-chat-session="view-a"]')?.textContent).toBe('other')
    expect(element.querySelector('[data-chat-session="view-b"]')?.textContent).toBe('chat')
    expect(a.editor.getRootElement()).toBe(editorA)
    expect(b.editor.getRootElement()).toBe(editorB)
    expect(element.querySelectorAll('[data-composer-input]')).toHaveLength(2)
    expect(a.props.inputActions?.persistDraft).toHaveBeenCalledTimes(1)
    expect(b.props.inputActions?.persistDraft).toHaveBeenCalledTimes(1)
  })
})
