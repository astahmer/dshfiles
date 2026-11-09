import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArchiveIcon } from '@dshfiles/plugin-ui/icons'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { DockNotice } from './dock-notice.js'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'

/**
 * Above an archived thread's composer: an "Archived" notice while the composer itself is blocked, so the thread reads
 * as history until it is restored. Same dock strip as the settled notice beside it.
 */
export const ArchivedThreadDock = (props: {
  readonly sessionId: SessionSummary['id']
  readonly workspaces: IWorkspaces
  readonly blocks: ComposerBlocks
  readonly t: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
}): JSX.Element | null => {
  const { sessionId, workspaces, blocks, t } = props
  const subscribe = useCallback((listener: () => void) => workspaces.list.subscribe(listener), [workspaces])
  const archived = useSyncExternalStore(subscribe, () => workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId))
  const composerReason = t('threadSidebarArchivedComposer')
  useEffect(() => {
    if (!archived) return
    blocks.set(sessionId, { reason: composerReason })
    return () => blocks.set(sessionId, undefined)
  }, [archived, blocks, composerReason, sessionId])
  const restore = useMutation({ mutationFn: () => workspaces.unarchiveSession(sessionId) })
  if (!archived) return null
  return (
    <DockNotice
      label={t('threadSidebarArchivedBanner')}
      heading={t('threadSidebarArchived')}
      icon={<ArchiveIcon className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden />}
      actionLabel={t('threadSidebarThreadActions')}
      actions={
        <Button size="sm" variant="default" disabled={restore.isPending} onClick={() => restore.mutate()}>
          {t('threadSidebarRestore')}
        </Button>
      }
    />
  )
}
