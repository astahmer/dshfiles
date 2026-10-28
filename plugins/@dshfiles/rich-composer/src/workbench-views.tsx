import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsRuntime, PropsRenderSlots, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from '@dshfiles/workbench/registry'
import { createContext, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode, type ComponentType } from 'react'
import type { ConversationContentProps, ConversationViewsProps } from './native/contract/slots.ts'
import type { ViewTab } from './native/contract/views.ts'

export const WORKBENCH_VIEW_SLOT = 'dshfiles.conversation.workbench-view'
export const WORKBENCH_VIEW_CHILDREN = { [WORKBENCH_VIEW_SLOT]: { kind: 'single', scope: 'session' } } as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'dshfiles.conversation.workbench-view': { kind: 'single'; scope: 'session'; owner: { readonly viewId: string } }
  }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    conversationWorkbenchView: unknown
  }
}

// Local to the owned Conversation bundle. No foreign renderer or private store crosses this boundary.
const ViewOnly = createContext(false)
const EmptyView = (): null => null
const OnlyFactoryViews = (props: ConversationContentProps): ReactNode => {
  const Views = props.useFactorySlot('views', EmptyView)
  // oxlint-disable-next-line react/static-components -- DSH's public Factory hook returns a renderer-cached component, not a component created here.
  return <Views />
}
/** The same public Factory; only this bundle's explicit view panels omit the composer. */
export const createConversationContentSurface = (Content: ComponentType<ConversationContentProps>) =>
  function ConversationContentSurface(props: ConversationContentProps): ReactNode {
    return useContext(ViewOnly) ? <OnlyFactoryViews {...props} /> : <Content {...props} />
  }

/** Public Factory local components keep conversation.session as the authorized view declarer. */
export const ConversationWorkbenchView = (props: PropsRuntime<typeof WORKBENCH_VIEW_SLOT> & PropsRenderFactories): ReactNode => {
  const { viewId } = props
  const SelectedView = useMemo(() => (viewProps: ConversationViewsProps) => viewProps.renderSlot('conversation.session', { view: viewId }), [viewId])
  return (
    <div
      className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col"
      data-workbench-conversation-view={viewId}
      data-workbench-conversation-session={props.sessionId}
    >
      <ViewOnly.Provider value>
        {props.renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: SelectedView } })}
      </ViewOnly.Provider>
    </div>
  )
}

type AuthorizedViews = PropsRenderSlots<typeof WORKBENCH_VIEW_SLOT>
export interface ConversationWorkbenchSession {
  readonly id: SessionId
  readonly title: string
}

/** Source identities and presentation registrations; the Controller remains the only Session owner. */
export class ConversationWorkbenchSources {
  static id(sessionId: SessionId, viewId: string): string {
    const encode = (value: string): string => Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('')
    return `dshfiles-conversation.view/${encode(sessionId)}/${encode(viewId)}`
  }

  static create(ports: {
    readonly registry: Pick<WorkbenchPanelRegistry, 'register'>
    readonly sessions: ObservableSnapshot<readonly ConversationWorkbenchSession[]>
    readonly views: ObservableSnapshot<readonly ViewTab[]>
    readonly retain: (sessionId: SessionId) => SessionReference
  }) {
    let authorized: AuthorizedViews | undefined
    const listeners = new Set<() => void>()
    const notify = (): void => {
      for (const listener of listeners) listener()
    }
    const subscribe = (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
    const snapshot = (): AuthorizedViews | undefined => authorized
    const registrations = new Map<string, { readonly definition: WorkbenchPanelDefinition; readonly dispose: () => void }>()

    const componentFor = (sessionId: SessionId, viewId: string): WorkbenchPanelDefinition['component'] =>
      function ConversationViewPanel() {
        const capability = useSyncExternalStore(subscribe, snapshot, snapshot)
        const [state, setState] = useState<{ readonly reference: SessionReference } | { readonly error: string }>()
        useLayoutEffect(() => {
          let active = true
          let reference: SessionReference | undefined
          try {
            reference = ports.retain(sessionId)
            // SessionProvider owns acquisition/settling. Never borrow its private binding here.
            setState({ reference })
            void reference.ready.catch(() => {
              if (active) setState({ error: 'Conversation unavailable. Close and reopen this panel to retry.' })
            })
          } catch {
            setState({ error: 'Conversation unavailable. Close and reopen this panel to retry.' })
          }
          return () => {
            active = false
            reference?.release()
          }
        }, [])
        if (state !== undefined && 'error' in state) return <div role="alert">{state.error}</div>
        if (capability === undefined || state === undefined) return <div role="status">Loading conversation view…</div>
        const Provider = capability.SessionProvider
        return <Provider session={state.reference}>{capability.renderSlot(WORKBENCH_VIEW_SLOT, { viewId })}</Provider>
      }

    const sync = (): void => {
      const desired = new Set<string>()
      for (const session of ports.sessions.getSnapshot())
        for (const view of ports.views.getSnapshot()) {
          if (view.id === 'chat') continue
          const id = ConversationWorkbenchSources.id(session.id, view.id)
          desired.add(id)
          const previous = registrations.get(id)
          const title = `${view.label} — ${session.title}`
          if (previous?.definition.title === title) continue
          const definition: WorkbenchPanelDefinition = {
            id,
            title,
            hiddenFromAdd: true,
            component: previous?.definition.component ?? componentFor(session.id, view.id),
          }
          const dispose = ports.registry.register(definition)
          previous?.dispose()
          registrations.set(id, { definition, dispose })
        }
      for (const [id, registration] of registrations)
        if (!desired.has(id)) {
          registration.dispose()
          registrations.delete(id)
        }
    }
    const disposeSessions = ports.sessions.subscribe(sync)
    const disposeViews = ports.views.subscribe(sync)
    sync()
    return {
      // Root assembly supplies only its own legal child renderer and Provider. It never caches occurrence hooks.
      Root: (props: AuthorizedViews): ReactNode => {
        const { renderSlot, SessionProvider } = props
        useLayoutEffect(() => {
          const capability = { renderSlot, SessionProvider }
          authorized = capability
          notify()
          return () => {
            if (authorized === capability) {
              authorized = undefined
              notify()
            }
          }
        }, [renderSlot, SessionProvider])
        return null
      },
      dispose: (): void => {
        disposeSessions()
        disposeViews()
        for (const registration of registrations.values()) registration.dispose()
        registrations.clear()
        authorized = undefined
        notify()
        listeners.clear()
      },
    }
  }
}
