import type {
  ISessions,
  SessionBinding,
  SessionListState,
  SessionReference,
  SessionRetainOptions,
  SessionSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
import {
  conversationPhase,
  EMPTY_CONVERSATION_SNAPSHOT,
  type ConversationContentInputProps,
  type ConversationSnapshot,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRuntime, SessionProviderComponent } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createContext, useContext } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkbenchThreadPanel, WorkbenchThreadConversation, WORKBENCH_CONVERSATION_SLOT } from './thread-panel.js'

// Native /client is a browser ModuleLoader entry, not Node ESM. Exercise its
// real pure contract implementation while leaving the Factory as the spy seam.
vi.mock('@deepseek-ai/dsh-client-ui-conversation/client', () => {
  // Variable URL keeps this runtime-only test contract out of Workbench's
  // declaration program/rootDir; it is never bundled into Workbench itself.
  const contract = new URL('../../rich-composer/src/native/contract/snapshot.ts', import.meta.url).pathname
  return vi.importActual(contract)
})

const a = SessionId('workbench-thread-a')
const b = SessionId('workbench-thread-b')
const fixture = () => {
  let state: SessionListState = {
    ids: [a, b],
    byId: {
      [a]: { id: a, displayTitle: 'Thread A', running: false, retainedBy: {}, blank: false, updatedAt: 0 },
      [b]: { id: b, displayTitle: 'Thread B', running: false, retainedBy: {}, blank: false, updatedAt: 0 },
    },
    phase: 'ready',
    projectionsBySession: {},
  }
  const listeners = new Set<() => void>()
  const held: Array<{ reference: SessionReference; release: ReturnType<typeof vi.fn>; options: SessionRetainOptions }> = []
  const sessions: Pick<ISessions, 'list' | 'retain'> = {
    list: {
      getSnapshot: () => state,
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    retain: (target, options) => {
      if (typeof target !== 'string') throw new Error('This fixture accepts catalogued Session ids only.')
      const release = vi.fn()
      const reference: SessionReference = {
        sessionId: target,
        // Binding materialization belongs to the native SessionProvider, not this wrapper.
        get binding(): SessionBinding {
          throw new Error('The panel wrapper must not borrow a private binding.')
        },
        ready: new Promise<SessionBinding>(() => undefined),
        release,
        [Symbol.dispose]: release,
      }
      held.push({ reference, release, options })
      return reference
    },
  }
  return {
    sessions,
    held,
    listeners,
    remove: (id: string) => {
      state = { ...state, ids: state.ids.filter(candidate => candidate !== id) }
      for (const listener of listeners) listener()
    },
  }
}

const BoundSession = createContext<string | null>(null)
const Provider: SessionProviderComponent = props => <BoundSession.Provider value={props.session?.sessionId ?? null}>{props.children}</BoundSession.Provider>
const Conversation = (props: { readonly label: string }) => <output aria-label={props.label}>{useContext(BoundSession)}</output>

afterEach(cleanup)

const emptySession = (): SessionSnapshot => ({
  sessionId: a,
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
})

type ConversationSources = Pick<PropsRuntime<typeof WORKBENCH_CONVERSATION_SLOT>, 'useSession' | 'useConversation' | 'useSessions'>
const conversationSources = (session: SessionSnapshot, conversation = EMPTY_CONVERSATION_SNAPSHOT, summaryBlank?: boolean): ConversationSources => ({
  useSession: selector => selector(session),
  useConversation: selector => selector(conversation),
  useSessions: selector =>
    selector({
      ids: [session.sessionId],
      byId:
        summaryBlank === undefined
          ? {}
          : {
              [session.sessionId]: {
                id: session.sessionId,
                displayTitle: 'Not evidence of emptiness',
                running: false,
                retainedBy: {},
                blank: summaryBlank,
                updatedAt: 0,
              },
            },
      phase: 'ready',
      projectionsBySession: {},
    }),
})

// The real Factories are the authorized native owners; this seam observes
// presentation inputs without reimplementing header, child views or composer.
const factory = () => {
  const calls = vi.fn()
  const headers = vi.fn()
  const sequence: string[] = []
  const renderFactorySlot: PropsRenderFactories['renderFactorySlot'] = (name, owner, options) => {
    sequence.push(name)
    if (name === 'dshfiles.workbench.conversation-header') {
      headers(owner, options)
      return <output aria-label="Native header" />
    }
    calls(name, owner, options)
    return <output aria-label="Native content" />
  }
  return { calls, headers, sequence, renderFactorySlot }
}

describe('fixed Conversation native hero policy', () => {
  const cases: Array<{
    label: string
    session?: Partial<SessionSnapshot>
    conversation?: ConversationSnapshot
    summaryBlank?: boolean
    phase: ConversationContentInputProps['phase']
    hero: boolean
  }> = [
    { label: 'opened native blank', phase: 'hero', hero: true },
    { label: 'authoritatively blank while cold', session: { openState: 'cold' }, summaryBlank: true, phase: 'hero', hero: true },
    { label: 'authoritatively blank while replaying', session: { openState: 'loading' }, summaryBlank: true, phase: 'hero', hero: true },
    { label: 'authoritatively blank after open error', session: { openState: 'error' }, summaryBlank: true, phase: 'hero', hero: true },
    { label: 'unknown while cold', session: { openState: 'cold' }, phase: 'active', hero: false },
    { label: 'unknown while replaying', session: { openState: 'loading' }, phase: 'settling', hero: false },
    { label: 'unknown after open error', session: { openState: 'error' }, phase: 'active', hero: false },
    { label: 'populated summary while replaying', session: { openState: 'loading' }, summaryBlank: false, phase: 'settling', hero: false },
    { label: 'native nonblank with no message counting', session: { blank: false }, phase: 'active', hero: false },
    { label: 'running without a user message', session: { running: true }, phase: 'active', hero: false },
    {
      label: 'registered target activity without a user message',
      conversation: { ...EMPTY_CONVERSATION_SNAPSHOT, activeTargets: new Set(['tools']) },
      phase: 'active',
      hero: false,
    },
    { label: 'first prompt engaging before durable turn', session: { promptAttempted: true, awaitingFirstTurn: true }, phase: 'active', hero: false },
    {
      label: 'first prompt awaiting turn despite nonblank echo',
      session: { blank: false, promptAttempted: true, awaitingFirstTurn: true },
      phase: 'active',
      hero: false,
    },
    { label: 'stale blank list cannot override a native turn', session: { blank: false }, summaryBlank: true, phase: 'active', hero: false },
    {
      label: 'continuable parent availability pending',
      session: { subagent: { address: { mode: 'continuable', parentSessionId: b, childSessionId: a } } },
      phase: 'settling',
      hero: true,
    },
  ]
  it.each(cases)('delegates $label to the unchanged native Factory', row => {
    const native = factory()
    const session = { ...emptySession(), ...row.session }
    const conversation = row.conversation ?? EMPTY_CONVERSATION_SNAPSHOT
    render(<WorkbenchThreadConversation {...conversationSources(session, conversation, row.summaryBlank)} renderFactorySlot={native.renderFactorySlot} />)
    // Keep this adapter aligned with the real native pure phase implementation,
    // without loading the disabled native UI module into production Workbench.
    expect(native.calls.mock.calls[0]?.[1].hero).toBe(
      conversationPhase(session, conversation) === 'blank' && (session.openState === 'open' || row.summaryBlank === true),
    )
    expect(native.calls).toHaveBeenCalledTimes(1)
    expect(native.calls.mock.calls[0]?.slice(0, 2)).toEqual(['conversation.content', { variant: 'embedded', phase: row.phase, hero: row.hero }])
    expect(screen.getAllByLabelText('Native content')).toHaveLength(1)
    expect(screen.getAllByLabelText('Native header')).toHaveLength(1)
    expect(native.headers).toHaveBeenCalledExactlyOnceWith({ reserveHostCorner: true }, undefined)
    expect(native.sequence).toEqual(['dshfiles.workbench.conversation-header', 'conversation.content'])
    // The native per-Session store, not a forced chat local component, selects child views.
    expect(native.calls.mock.calls[0]?.[2]).toBeUndefined()
  })

  it('keeps both native Factories resident across draft, first turn, switch and reload', () => {
    const native = factory()
    const props = conversationSources(emptySession())
    const view = render(<WorkbenchThreadConversation {...props} renderFactorySlot={native.renderFactorySlot} />)
    const element = screen.getByLabelText('Native content')
    const header = screen.getByLabelText('Native header')
    // An unsent draft does not alter either native Session phase source.
    view.rerender(<WorkbenchThreadConversation {...conversationSources(emptySession())} renderFactorySlot={native.renderFactorySlot} />)
    expect(native.calls.mock.calls.at(-1)?.[1]).toEqual({ variant: 'embedded', phase: 'hero', hero: true })
    view.rerender(
      <WorkbenchThreadConversation
        {...conversationSources({ ...emptySession(), promptAttempted: true, running: true })}
        renderFactorySlot={native.renderFactorySlot}
      />,
    )
    expect(native.calls.mock.calls.at(-1)?.[1]).toEqual({ variant: 'embedded', phase: 'active', hero: false })
    view.rerender(
      <WorkbenchThreadConversation {...conversationSources({ ...emptySession(), sessionId: b, blank: false })} renderFactorySlot={native.renderFactorySlot} />,
    )
    expect(native.calls.mock.calls.at(-1)?.[1]).toEqual({ variant: 'embedded', phase: 'active', hero: false })
    view.rerender(<WorkbenchThreadConversation {...props} renderFactorySlot={native.renderFactorySlot} />)
    expect(native.calls.mock.calls.at(-1)?.[1]).toEqual({ variant: 'embedded', phase: 'hero', hero: true })
    expect(screen.getByLabelText('Native content')).toBe(element)
    expect(screen.getByLabelText('Native header')).toBe(header)
    expect(native.calls.mock.calls.every(call => call[2] === undefined)).toBe(true)
    view.unmount()
    render(<WorkbenchThreadConversation {...props} renderFactorySlot={native.renderFactorySlot} />)
    expect(native.calls.mock.calls.at(-1)?.[1]).toEqual({ variant: 'embedded', phase: 'hero', hero: true })
  })
})

describe('workbench thread panel Session ownership', () => {
  it('gives the embedded flex conversation a viewport-sized flex containing block', () => {
    const owner = fixture()
    const ThreadPanel = createWorkbenchThreadPanel(owner.sessions)
    render(<ThreadPanel sessionId={a} SessionProvider={Provider} renderConversation={() => <Conversation label="Panel" />} />)
    const host = screen.getByLabelText('Panel').closest('[data-workbench-thread]')
    expect(host).not.toBeNull()
    expect(host?.classList.contains('dshx:flex')).toBe(true)
    expect(host?.classList.contains('dshx:flex-col')).toBe(true)
    expect(host?.classList.contains('dshx:h-full')).toBe(true)
    expect(host?.classList.contains('dshx:min-h-0')).toBe(true)
    expect(host?.classList.contains('dshx:overflow-hidden')).toBe(true)
  })

  it('binds two split panels to independent explicit Session references and releases each on disposal', () => {
    const owner = fixture()
    const ThreadPanel = createWorkbenchThreadPanel(owner.sessions)
    const view = render(
      <>
        <ThreadPanel sessionId={a} SessionProvider={Provider} renderConversation={() => <Conversation label="Panel A" />} />
        <ThreadPanel sessionId={b} SessionProvider={Provider} renderConversation={() => <Conversation label="Panel B" />} />
      </>,
    )
    expect(screen.getByLabelText('Panel A').textContent).toBe(a)
    expect(screen.getByLabelText('Panel B').textContent).toBe(b)
    expect(owner.held.map(item => item.reference.sessionId)).toEqual([a, b])
    expect(owner.held.every(item => item.options.source === 'workbenchPanel')).toBe(true)
    expect(owner.held.every(item => item.options.signal?.aborted === false)).toBe(true)
    view.unmount()
    expect(owner.held.every(item => item.options.signal?.aborted === true)).toBe(true)
    for (const item of owner.held) expect(item.release).toHaveBeenCalledTimes(1)
    expect(owner.listeners.size).toBe(0)
  })

  it('never renders the old reference under a changed panel identity', () => {
    const owner = fixture()
    const ThreadPanel = createWorkbenchThreadPanel(owner.sessions)
    const rendered: string[] = []
    const RecordingProvider: SessionProviderComponent = props => {
      rendered.push(props.session?.sessionId ?? 'none')
      return <Provider {...props} />
    }
    const renderConversation = () => <Conversation label="Panel" />
    const view = render(<ThreadPanel sessionId={a} SessionProvider={RecordingProvider} renderConversation={renderConversation} />)
    const before = rendered.length
    view.rerender(<ThreadPanel sessionId={b} SessionProvider={RecordingProvider} renderConversation={renderConversation} />)
    expect(rendered.slice(before)).toEqual([b])
    expect(screen.getByLabelText('Panel').textContent).toBe(b)
    expect(owner.held[0]?.release).toHaveBeenCalledTimes(1)
    expect(owner.held[0]?.options.signal?.aborted).toBe(true)
    expect(owner.held[1]?.release).not.toHaveBeenCalled()
  })

  it('does not retain unknown ids and releases a removed thread without borrowing the current Session', () => {
    const owner = fixture()
    const ThreadPanel = createWorkbenchThreadPanel(owner.sessions)
    const view = render(<ThreadPanel sessionId="missing" SessionProvider={Provider} renderConversation={() => <Conversation label="Panel" />} />)
    expect(owner.held).toHaveLength(0)
    expect(screen.queryByLabelText('Panel')).toBeNull()
    view.rerender(<ThreadPanel sessionId={a} SessionProvider={Provider} renderConversation={() => <Conversation label="Panel" />} />)
    expect(screen.getByLabelText('Panel').textContent).toBe(a)
    act(() => owner.remove(a))
    expect(screen.queryByLabelText('Panel')).toBeNull()
    expect(owner.held[0]?.release).toHaveBeenCalledTimes(1)
    expect(owner.held[0]?.options.signal?.aborted).toBe(true)
  })
})
