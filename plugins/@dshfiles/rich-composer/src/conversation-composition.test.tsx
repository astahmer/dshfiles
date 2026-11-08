// @vitest-environment jsdom
import { act, type ReactNode, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { createEditor } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore, type SnapshotSelectorHook, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComposerBarProps, ConversationContentProps, ConversationSessionHeaderSlotProps, ConversationSessionSlotProps } from './native/contract/slots.ts'
import { ConversationSessionHeader } from './native/skeleton/ConversationSession.tsx'
import type { InputState } from './native/contract/input.ts'
import type { InputZone } from './native/contract/slots.ts'
import { EMPTY_CONVERSATION_SNAPSHOT } from './native/contract/snapshot.ts'
import { ConversationContent } from './native/skeleton/ConversationContent.tsx'
import { ConversationWidthControls } from './native/skeleton/ConversationWidthControls.tsx'
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

interface FixtureOptions {
  readonly inputStore?: SnapshotStore<InputState>
  readonly renderView?: () => ReactNode
}

const storeBackedInput =
  (store: SnapshotStore<InputState>): SnapshotSelectorHook<InputState> =>
  <S,>(selector: (state: InputState) => S): S =>
    useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))

const fixture = (id: string, initialView = 'chat', fixtureOptions: FixtureOptions = {}) => {
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
    useInput: fixtureOptions.inputStore === undefined ? selected(input) : storeBackedInput(fixtureOptions.inputStore),
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
    renderSlot: (name, _owner, options) =>
      name === 'conversation.view' && fixtureOptions.renderView !== undefined ? (
        fixtureOptions.renderView()
      ) : (
        <output data-chat-session={sessionId}>{options?.only}</output>
      ),
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

  it('defaults a main occurrence, and only a main one, to the transcript width handles', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
    const main = fixture('width-main')
    const embedded = fixture('width-embedded')
    const widthFallbacks = new Map<string, unknown>()
    const recording =
      (session: string): ConversationContentProps['useFactorySlot'] =>
      (name, fallback) => {
        if (name === 'widthControls') widthFallbacks.set(session, fallback)
        return main.props.useFactorySlot(name, fallback)
      }
    const element = document.createElement('div')
    document.body.append(element)
    const root = createRoot(element)
    dispose.push(() => act(() => root.unmount()))
    act(() =>
      root.render(
        <>
          <ConversationContent {...main.props} variant="main" useFactorySlot={recording('main')} />
          <ConversationContent {...embedded.props} useFactorySlot={recording('embedded')} />
        </>,
      ),
    )
    expect(widthFallbacks.get('main')).toBe(ConversationWidthControls)
    expect(widthFallbacks.get('embedded')).not.toBe(ConversationWidthControls)
  })

  it('keeps the title editor responsive after a rename fails', async () => {
    const { header } = fixture('rename-a')
    const rename = vi.fn<ConversationSessionHeaderSlotProps['rename']>().mockRejectedValueOnce(new Error('Host refused')).mockResolvedValue(undefined)
    const element = document.createElement('div')
    document.body.append(element)
    const root = createRoot(element)
    dispose.push(() => act(() => root.unmount()))
    act(() => root.render(<ConversationSessionHeader {...header} rename={rename} />))
    const titleButton = Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'rename-a')
    act(() => titleButton?.click())
    const titleInput = () => element.querySelector<HTMLInputElement>('input[aria-label="session.renameTitle"]')
    const type = (value: string) =>
      act(() => {
        const input = titleInput()
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
        input?.dispatchEvent(new Event('input', { bubbles: true }))
      })
    const press = (key: string) => act(async () => void titleInput()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
    type('first try')
    await press('Enter')
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('session.renameFailed')
    type('second try')
    await press('Enter')
    expect(rename).toHaveBeenNthCalledWith(2, header.sessionId, 'second try')
    expect(titleInput()).toBeNull()
  })

  it('drops the title row on a phone and shows the header controls only while the thread menu is open', async () => {
    const slotMarker: ConversationSessionHeaderSlotProps['renderSlot'] = name => <span data-test-slot={name} />
    const chat = fixture('menu-chat')
    const other = fixture('menu-other', 'other')
    const element = document.createElement('div')
    document.body.append(element)
    const root = createRoot(element)
    dispose.push(() => act(() => root.unmount()))
    const html = document.documentElement
    dispose.push(() => {
      html.removeAttribute('data-shell-phone-nav')
      html.removeAttribute('data-phone-thread-tools')
    })
    act(() =>
      root.render(
        <>
          <section data-bound-session="menu-chat">
            <ConversationSessionHeader {...chat.header} renderSlot={slotMarker} />
          </section>
          <section data-bound-session="menu-other">
            <ConversationSessionHeader {...other.header} renderSlot={slotMarker} />
          </section>
        </>,
      ),
    )
    const inChat = (selector: string) => element.querySelector(`[data-bound-session="menu-chat"] ${selector}`)
    const inOther = (selector: string) => element.querySelector(`[data-bound-session="menu-other"] ${selector}`)
    const slot = (name: string) => `[data-test-slot="conversation.session.header.${name}"]`
    expect(inChat(slot('utilities'))).not.toBeNull()
    expect(Array.from(element.querySelectorAll('button'), button => button.textContent)).toContain('menu-chat')

    await act(async () => html.setAttribute('data-shell-phone-nav', ''))
    expect(Array.from(element.querySelectorAll('button'), button => button.textContent)).not.toContain('menu-chat')
    for (const name of ['actions', 'utilities', 'corner']) expect(inChat(slot(name))).toBeNull()
    expect(inChat('[data-conversation-tabs]')).toBeNull()
    expect(inOther('[data-conversation-tabs]')).not.toBeNull()

    await act(async () => html.setAttribute('data-phone-thread-tools', ''))
    for (const name of ['actions', 'utilities', 'corner']) expect(inChat(`[data-phone-thread-menu] ${slot(name)}`)).not.toBeNull()
    expect(inChat('[data-phone-thread-menu] [data-conversation-tabs]')).not.toBeNull()
    expect(element.querySelectorAll('[data-bound-session="menu-other"] [data-conversation-tabs]')).toHaveLength(1)

    await act(async () => html.removeAttribute('data-phone-thread-tools'))
    expect(inChat('[data-phone-thread-menu]')).toBeNull()
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

  it('publishes a draft to the dock without re-rendering the Conversation view', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
    const inputStore = createSnapshotStore<InputState>({
      draft: '',
      attachmentIds: [],
      draftRev: 0,
      phase: 'plain',
      occurrences: [],
      queue: [],
    })
    const viewRenders = { count: 0 }
    const CountingView = () => {
      viewRenders.count += 1
      return <output data-chat-session="dock-live" />
    }
    const { props } = fixture('dock-live', 'chat', { inputStore, renderView: () => <CountingView /> })
    const dockDrafts: string[] = []
    const element = document.createElement('div')
    document.body.append(element)
    const root = createRoot(element)
    dispose.push(() => act(() => root.unmount()))
    act(() =>
      root.render(
        <ConversationContent
          {...props}
          renderSlot={(name, owner) => {
            if (name !== 'conversation.input.dock' || !('input' in owner)) return null
            // SAFETY: the slot map declares `conversation.input.dock` with one owner shape, `InputZone`; the name check above is that correlation.
            const draft = (owner as unknown as InputZone).input.draft
            dockDrafts.push(draft)
            return <output data-dock-draft={draft} />
          }}
        />,
      ),
    )
    const mountedViewRenders = viewRenders.count
    expect(dockDrafts.at(-1)).toBe('')
    act(() => inputStore.set({ ...inputStore.getSnapshot(), draft: 'typed', draftRev: 1 }))
    expect(dockDrafts.at(-1)).toBe('typed')
    expect(element.querySelector('[data-dock-draft]')?.getAttribute('data-dock-draft')).toBe('typed')
    // The composer publishes on every content change; a draft keystroke must not
    // reach the Conversation body, whose View re-render costs the transcript.
    expect(viewRenders.count).toBe(mountedViewRenders)
  })
})
