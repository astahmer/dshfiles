import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArchiveIcon } from '@dshfiles/plugin-ui/icons'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'

/**
 * Above an archived thread's composer: a "Restore to reply" banner, while the composer itself is blocked so the
 * thread reads as history until it is restored.
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
    <div
      role="status"
      aria-label={t('threadSidebarArchivedBanner')}
      className="dshx-root dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted dshx:px-3 dshx:py-1.5 dshx:text-sm dshx:text-muted-foreground"
    >
      <ArchiveIcon className="dshx:size-4 dshx:shrink-0" aria-hidden />
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{t('threadSidebarArchivedBanner')}</span>
      <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate()}>
        {t('threadSidebarRestoreToReply')}
      </Button>
    </div>
  )
}
