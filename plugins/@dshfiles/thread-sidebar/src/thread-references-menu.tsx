import { useApiQuery } from '@dshfiles/dshx/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComponentType, JSX, ReactNode } from 'react'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE, type ThreadSidebarLocaleKey } from './locales.js'
import { threadActionsApi } from './thread-actions-api.js'
import type { ThreadReferenceRelation } from './thread-references.js'

/** One reference row as a menu shows it. */
export interface ThreadReferenceMenuRow {
  readonly sessionId: SessionId
  readonly label: string
  readonly hint: ThreadSidebarLocaleKey
}

export type ThreadReferencesState =
  | { readonly kind: 'loading' | 'failed' | 'empty' | 'degraded' }
  | { readonly kind: 'ready'; readonly rows: readonly ThreadReferenceMenuRow[]; readonly omitted: number; readonly degraded: boolean }

const relationLabelKeys = {
  fork: 'threadSidebarReferenceFork',
  subagent: 'threadSidebarReferenceSubagent',
  mention: 'threadSidebarReferenceMention',
} as const satisfies Record<ThreadReferenceRelation, ThreadSidebarLocaleKey>

const statusLabelKeys = {
  loading: 'threadSidebarReferencesLoading',
  failed: 'threadSidebarReferencesFailed',
  empty: 'threadSidebarReferencesEmpty',
  degraded: 'threadSidebarReferencesDegraded',
} as const satisfies Record<'loading' | 'failed' | 'empty' | 'degraded', ThreadSidebarLocaleKey>

/** The props both Radix item primitives accept for one reference row. */
export interface ThreadReferenceItemProps {
  readonly children?: ReactNode
  readonly disabled?: boolean
  readonly onSelect?: (event: Event) => void
}

export interface ThreadReferencesItemsProps {
  readonly sessionId: SessionId
  readonly t: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
  readonly openThread: (sessionId: SessionId) => void
  /** The menu's own item primitive: the header and the context menu use different ones. */
  readonly Item: ComponentType<ThreadReferenceItemProps>
}

/** The threads that reference one thread, fetched when its reference submenu opens. */
const useThreadReferences = (sessionId: SessionId, limit?: number): ThreadReferencesState => {
  const query = useApiQuery(threadActionsApi, 'references', {
    input: { sessionId, ...(limit === undefined ? undefined : { limit }) },
  })
  if (query.error !== null) return { kind: 'failed' }
  if (query.status !== 'success') return { kind: 'loading' }
  if (query.data.references.length === 0) return { kind: query.data.degraded ? 'degraded' : 'empty' }
  return {
    kind: 'ready',
    rows: query.data.references.map(reference => ({
      sessionId: SessionId(reference.sessionId),
      label: reference.title ?? reference.sessionId,
      hint: relationLabelKeys[reference.relation],
    })),
    omitted: query.data.omitted,
    degraded: query.data.degraded,
  }
}

/** The reference rows of one thread, shared by the row context menu and the header menu. */
export const ThreadReferencesItems = ({ sessionId, t, openThread, Item }: ThreadReferencesItemsProps): JSX.Element => {
  const state = useThreadReferences(sessionId)
  if (state.kind !== 'ready') return <Item disabled>{t(statusLabelKeys[state.kind])}</Item>
  return (
    <>
      {state.rows.map(row => (
        <Item key={row.sessionId} onSelect={() => openThread(row.sessionId)}>
          <span className="dshx:min-w-0 dshx:truncate">{row.label}</span>
          <span className="dshx:ml-auto dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">{t(row.hint)}</span>
        </Item>
      ))}
      {state.omitted === 0 ? null : <Item disabled>{t('threadSidebarReferencesOmitted')}</Item>}
      {state.degraded ? <Item disabled>{t('threadSidebarReferencesDegraded')}</Item> : null}
    </>
  )
}
