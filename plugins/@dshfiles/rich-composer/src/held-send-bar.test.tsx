// @vitest-environment jsdom
import { act, useSyncExternalStore, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createEditor } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { FileUploadReceiptId } from '@deepseek-ai/dsh-client-file-upload/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerAttachment, ComposerBarProps, DraftFileUploads } from './native/contract/slots.ts'
import type { DraftAttachmentId, InputState } from './native/contract/input.ts'
import { InputBar } from './native/skeleton/InputBar.tsx'
import { DraftAnnotations } from './native/input/draft-annotations.ts'
import { SendWhenUploaded } from './held-send.ts'

// The held send is plain composer state inside the real InputBar: the presentation kit is not under test.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  focusWithoutRing: () => undefined,
  HoverCardGroup: (props: { children: ReactNode }) => props.children,
  IconPlusOutlineMedium: () => null,
  IconTriangleRightFillRegular: () => null,
  isMobileDevice: () => false,
  IconWarningOutlineRegular: () => null,
  Tooltip: (props: { children: ReactNode }) => props.children,
  Toast: (props: { text: string }) => <output data-toast="">{props.text}</output>,
  useAnchoredPosition: () => ({}),
  useDismissOnOutsidePointer: () => undefined,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const liveStore = <T,>(initial: T) => {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const hook: SnapshotSelectorHook<T> = selector => selector(useSyncExternalStore(subscribe, () => value))
  return {
    hook,
    set: (next: T) => {
      value = next
      act(() => {
        for (const listener of listeners) listener()
      })
    },
  }
}

const dispose: Array<() => void> = []
afterEach(() => {
  for (const release of dispose.splice(0).reverse()) release()
  document.body.replaceChildren()
  SendWhenUploaded.set(true)
  vi.unstubAllGlobals()
})

// SAFETY: draft attachment and receipt ids are opaque brands; the bar only compares them.
const fileId = 'a1' as DraftAttachmentId
// SAFETY: as above, the receipt id is only carried, never parsed.
const receiptId = 'r1' as FileUploadReceiptId
const fileAttachment: ComposerAttachment = { kind: 'file', id: fileId, file: new File(['x'], 'big.bin') }

const mountBar = (options: { running?: boolean } = {}) => {
  const sessionId = SessionId('held-send')
  const editor = createEditor({
    namespace: 'held-send',
    onError: error => {
      throw error
    },
  })
  const session: SessionSnapshot = {
    sessionId,
    pendingSubmissions: [],
    running: options.running ?? false,
    subagent: null,
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    historyWasPartial: false,
    historyLoadStatus: 'idle',
    promptError: null,
    blank: false,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  }
  const input = liveStore<InputState>({ draft: 'look at this', attachmentIds: [fileId], draftRev: 0, phase: 'plain', occurrences: [], queue: [] })
  const uploads = liveStore<DraftFileUploads>({ [fileId]: { status: 'uploading', loaded: 10, total: 100 } })
  const submit = vi.fn()
  // SAFETY: the bar renders only the paths these tests exercise, which read the props listed here.
  const props = {
    sessionId,
    useSession: (selector => selector(session)) satisfies SnapshotSelectorHook<SessionSnapshot>,
    useInput: input.hook,
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
      snapshot: { draft: '', attachmentIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [] },
      annotations: new DraftAnnotations(),
      submit,
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
    resolveDraftAttachments: (ids: readonly DraftAttachmentId[]) => (ids.includes(fileId) ? [fileAttachment] : []),
    retryFileUpload: vi.fn(),
    promptHistory: () => [],
    toggleCommandMenu: vi.fn(),
    stop: vi.fn(),
    retry: undefined,
    registerFileIntake: () => () => undefined,
    occurrence: 'main',
    useAccess: () => true,
    insertReference: vi.fn(),
    useBusyEnter: (selector => selector('steer')) satisfies SnapshotSelectorHook<'steer'>,
    useFileUploads: uploads.hook,
    useNotices: (selector => selector(null)) satisfies SnapshotSelectorHook<null>,
    useLexicon: vi.fn(),
    useMenuLauncher: (selector => selector(null)) satisfies SnapshotSelectorHook<null>,
    useStopShortcut: (selector => selector([])) satisfies SnapshotSelectorHook<readonly string[]>,
    renderSlot: () => null,
    SessionProvider: (inner: { children: ReactNode }) => inner.children,
    t: (key: string) => key,
  } as ComposerBarProps
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
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
  const send = (): HTMLButtonElement => {
    const button = element.querySelector<HTMLButtonElement>('[data-send-mode]')
    if (button === null) throw new Error('the bar has no Send button')
    return button
  }
  const press = () => act(() => send().click())
  return { element, input, uploads, submit, send, press }
}

describe('Send while uploads run', () => {
  it('waits with a visible held state, then sends by itself once the upload is ready', () => {
    const bar = mountBar()
    bar.press()
    expect(bar.submit).not.toHaveBeenCalled()
    expect(bar.send().dataset.sendMode).toBe('held')
    expect(bar.element.querySelector('[data-held-send]')?.textContent).toContain('input.send.held')
    expect(bar.element.querySelector('[data-toast]')).toBeNull()
    bar.uploads.set({ [fileId]: { status: 'ready', receiptId } })
    expect(bar.submit).toHaveBeenCalledExactlyOnceWith('queue', 'click')
    expect(bar.element.querySelector('[data-held-send]')).toBeNull()
  })

  it('keeps the steer mode Send was pressed for while a turn runs', () => {
    const bar = mountBar({ running: true })
    bar.press()
    bar.uploads.set({ [fileId]: { status: 'ready', receiptId } })
    expect(bar.submit).toHaveBeenCalledExactlyOnceWith('steer', 'click')
  })

  it('drops the held send when the draft is edited, so a later upload does not send', () => {
    const bar = mountBar()
    bar.press()
    bar.input.set({ draft: 'look at this one', attachmentIds: [fileId], draftRev: 1, phase: 'plain', occurrences: [], queue: [] })
    expect(bar.element.querySelector('[data-held-send]')).toBeNull()
    bar.uploads.set({ [fileId]: { status: 'ready', receiptId } })
    expect(bar.submit).not.toHaveBeenCalled()
  })

  it('cancels on a second press of the waiting Send', () => {
    const bar = mountBar()
    bar.press()
    bar.press()
    expect(bar.element.querySelector('[data-held-send]')).toBeNull()
    bar.uploads.set({ [fileId]: { status: 'ready', receiptId } })
    expect(bar.submit).not.toHaveBeenCalled()
  })

  it('drops it on a failed upload and shows the failure instead', () => {
    const bar = mountBar()
    bar.press()
    bar.uploads.set({ [fileId]: { status: 'error', message: 'network' } })
    expect(bar.submit).not.toHaveBeenCalled()
    expect(bar.element.querySelector('[data-held-send]')).toBeNull()
    expect(bar.element.querySelector('[data-toast]')?.textContent).toContain('file.uploadFailed')
  })

  it('refuses with the notice when the setting is off', () => {
    SendWhenUploaded.set(false)
    const bar = mountBar()
    bar.press()
    expect(bar.element.querySelector('[data-held-send]')).toBeNull()
    expect(bar.element.querySelector('[data-toast]')?.textContent).toBe('file.stillUploading')
    bar.uploads.set({ [fileId]: { status: 'ready', receiptId } })
    expect(bar.submit).not.toHaveBeenCalled()
  })
})
