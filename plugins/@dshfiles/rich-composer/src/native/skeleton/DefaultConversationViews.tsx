import { useEffect, useSyncExternalStore } from 'react'
import { ThreadViewsModel } from '../../thread-views.ts'
import type { ConversationSessionSlotProps } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { DEFAULT_VIEW_ID, resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft persisted while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function DefaultConversationViews({
  view, useSession, useConversation, useConversationViews, inputActions, useStore, actions,
  renderSlot, bindDraftPersistence, openView, useInspectCall,
}: ConversationSessionSlotProps) {
  const tabs = useConversationViews(value => value)
  const inspectCall = useInspectCall(value => value)
  const selectedId = useStore(s => s.view)
  // Productivity pass Q5 (E5): where a thread panel hosts the other views as facets, the stage is Chat and a stored
  // view selection never replaces it; without one (no right pane) the header's view switch still drives the stage.
  const facetsHosted = useSyncExternalStore(ThreadViewsModel.subscribe, ThreadViewsModel.hosted, ThreadViewsModel.hosted)
  const active = resolveActiveView(tabs, facetsHosted ? DEFAULT_VIEW_ID : selectedId)
  const session = useSession(s => s)
  const activeTargets = useConversation(s => s.activeTargets)
  const viewRequest = useStore(s => s.viewRequest ?? null)

  useEffect(() => {
    const unbindDraftPersistence = bindDraftPersistence(actions.setDraft)
    inputActions.persistDraft()
    return () => { unbindDraftPersistence() }
    // The Session input owns content before this persistence writer is attached.
  }, [inputActions])

  if (session.blank && conversationPhase(session, { activeTargets }) === 'blank') return null
  const viewId = view ?? active?.id
  return (
    <div className={css.viewArea}>
      {viewId !== undefined && renderSlot('conversation.view', {
        inspectCall,
        viewRequest,
        openView,
        completeViewRequest: actions.completeViewRequest,
      }, { only: viewId })}
    </div>
  )
}
