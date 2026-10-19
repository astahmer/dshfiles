import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArchiveIcon, CheckCircleIcon } from '@dshfiles/plugin-ui/icons'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { SidebarOrganization } from './organization.js'
import { SettledThreadsModel } from './settled-threads.js'
import { usePreferences } from './sidebar-state.js'
import { threadDelayMs } from './thread-delays.js'

/**
 * Above a settled thread's composer: a "This thread is settled." banner, while the composer itself is
 * blocked. The Host refuses the model step a settled Session proposes, so the click that lifts the
 * status has to be here rather than a message that would end as `blocked`. It reads like the jj rebase
 * notice: the settle date and the archive time on the right, the actions beside them.
 *
 * It reads the sidebar's own preference source: the same Host settings when the Client has them, and
 * the same browser copy when a Host without the Settings namespace is serving the panel.
 */
export const SettledThreadDock = (props: {
  readonly sessionId: SessionSummary['id']
  readonly workspaces: IWorkspaces
  readonly blocks: ComposerBlocks
  readonly t: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
}): JSX.Element | null => {
  const { sessionId, workspaces, blocks, t } = props
  const { preferences, updatePreferences } = usePreferences()
  const subscribeToWorkspaces = useCallback((listener: () => void) => workspaces.list.subscribe(listener), [workspaces])
  // Archived dominates settled: the archived banner owns an archived thread's composer.
  const archived = useSyncExternalStore(
    subscribeToWorkspaces,
    () => workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId),
    () => false,
  )
  const settled = preferences.settledSessionIds.includes(sessionId) && !archived
  const settledAt = preferences.settledAt[sessionId]
  const archiveAt = SettledThreadsModel.archiveTime({ settledAt, delayMs: threadDelayMs(preferences.settledArchiveDelay) })
  const composerReason = t('threadSidebarSettledComposer')
  useEffect(() => {
    if (!settled) return
    blocks.set(sessionId, { reason: composerReason })
    return () => blocks.set(sessionId, undefined)
  }, [blocks, composerReason, sessionId, settled])
  const archive = useMutation({
    mutationFn: () => SidebarOrganization.archiveWithoutStopping((targetId, options) => workspaces.archiveSession(targetId, options), sessionId),
  })
  if (!settled) return null
  return (
    <div
      role="status"
      aria-label={t('threadSidebarSettledBanner')}
      className="dshx-root dshx:mx-auto dshx:my-3 dshx:flex dshx:w-full dshx:max-w-3xl dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted dshx:px-3 dshx:py-2 dshx:text-sm dshx:text-muted-foreground"
    >
      <CheckCircleIcon className="dshx:size-4 dshx:shrink-0" aria-hidden />
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{t('threadSidebarSettledBanner')}</span>
      {settledAt === undefined ? null : (
        <time className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums" dateTime={new Date(settledAt).toISOString()}>
          {t('threadSidebarSettledAt', { when: new Date(settledAt).toLocaleString() })}
        </time>
      )}
      {archiveAt === undefined ? null : (
        <time className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums" dateTime={new Date(archiveAt).toISOString()}>
          {t('threadSidebarSettledArchiveAt', { when: new Date(archiveAt).toLocaleString() })}
        </time>
      )}
      <Button size="sm" variant="outline" disabled={archive.isPending} onClick={() => archive.mutate()}>
        <ArchiveIcon className="dshx:size-4" aria-hidden />
        {t('threadSidebarArchive')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          updatePreferences(SettledThreadsModel.unsettle({ settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }, [sessionId]))
        }
      >
        {t('threadSidebarUnsettleToReply')}
      </Button>
    </div>
  )
}
