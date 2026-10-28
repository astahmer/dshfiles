import type { ISessions, SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationContentInputProps, ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from './conversation-header.js'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRenderFactories, PropsRuntime, SessionProviderComponent } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'

export const WORKBENCH_CONVERSATION_SLOT = 'dshfiles.workbench.conversation'
export const WORKBENCH_THREAD_CHILDREN = { [WORKBENCH_CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } } as const

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A workbench thread panel retains one explicit Controller generation. */
    workbenchPanel: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'dshfiles.workbench.conversation': { kind: 'single'; scope: 'session' }
  }
}

/** Native MainPanel layout policy, without a second Session/editor state owner. */
export class HeroPolicy {
  static content(session: SessionSnapshot, conversation: ConversationSnapshot, summaryBlank: boolean | undefined): ConversationContentInputProps {
    // Native ui-conversation's value module is disabled by RichComposer. Use
    // its exact phase facts through public snapshot selectors, not a runtime
    // import of that disabled owner or a second state/projection implementation.
    const active = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
    const blank = !active && !session.promptAttempted
    // Neither an unsent draft nor a count of user messages proves a native turn.
    const parentAvailabilityPending = session.subagent?.address.mode === 'continuable' && session.subagent.parentAvailable === undefined
    const settling = (blank && session.openState === 'loading' && summaryBlank !== true) || parentAvailabilityPending
    // A cold/loading/error snapshot alone cannot prove an empty Session. The
    // native list's authoritative blank summary is MainPanel's early proof.
    const hero = blank && (session.openState === 'open' || summaryBlank === true)
    return { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero }
  }
}

type ConversationSources = Pick<PropsRuntime<typeof WORKBENCH_CONVERSATION_SLOT>, 'useSession' | 'useConversation' | 'useSessions'>

/** Register this child once; each occurrence binds the SessionProvider surrounding its own panel. */
export const WorkbenchThreadConversation = (props: ConversationSources & PropsRenderFactories): ReactNode => {
  const session = props.useSession(snapshot => snapshot)
  const conversation = props.useConversation(snapshot => snapshot)
  const summaryBlank = props.useSessions(snapshot => snapshot.byId[session.sessionId]?.blank)
  // Both producer-owned Factories inherit this panel's fixed Session. Native
  // Content keeps its resident editor and per-Session child-view selection.
  return (
    <>
      {props.renderFactorySlot('dshfiles.workbench.conversation-header', { reserveHostCorner: true })}
      {props.renderFactorySlot('conversation.content', HeroPolicy.content(session, conversation, summaryBlank))}
    </>
  )
}

export interface WorkbenchThreadPanelProps {
  readonly sessionId: string
  /** Supplied by the shell.main registration declaring WORKBENCH_THREAD_CHILDREN. */
  readonly SessionProvider: SessionProviderComponent
  /** Delegates that registration's authorized child renderSlot, not another main conversation. */
  readonly renderConversation: () => ReactNode
}

/** Call once at the client composition root. Every mounted panel owns and releases its own reference. */
export const createWorkbenchThreadPanel = (sessions: Pick<ISessions, 'list' | 'retain'>) => {
  const subscribe = (listener: () => void) => sessions.list.subscribe(listener)
  const getSnapshot = () => sessions.list.getSnapshot()
  return function WorkbenchThreadPanel(props: WorkbenchThreadPanelProps): ReactNode {
    const list = useSyncExternalStore(subscribe, getSnapshot)
    const listedId = list.ids.find(id => id === props.sessionId)
    const [reference, setReference] = useState<SessionReference>()
    useEffect(() => {
      if (listedId === undefined) {
        setReference(undefined)
        return
      }
      const abort = new AbortController()
      const retained = sessions.retain(listedId, { source: 'workbenchPanel', signal: abort.signal })
      setReference(retained)
      // The Session-scoped conversation owns loading/open-error rendering.
      // Consume acquisition rejection so a closed panel cannot leave an unhandled waiter.
      void retained.ready.catch(() => undefined)
      return () => {
        abort.abort()
        retained.release()
      }
    }, [listedId])
    if (listedId === undefined || reference?.sessionId !== listedId) return null
    // SessionProvider and Slot outlets use display:contents. The embedded body is
    // flex:1, so it needs this real flex parent rather than the generic block panel:
    // otherwise a long transcript grows the body past Dockview and hides its input.
    return (
      <div data-workbench-thread="" className="dshx:flex dshx:h-full dshx:min-h-0 dshx:min-w-0 dshx:flex-col dshx:overflow-hidden">
        <props.SessionProvider session={reference}>{props.renderConversation()}</props.SessionProvider>
      </div>
    )
  }
}
