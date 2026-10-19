import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArchiveIcon, CheckCircleIcon } from '@dshfiles/plugin-ui/icons'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { DockNotice } from './dock-notice.js'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { SidebarOrganization } from './organization.js'
import { formatAge, formatRemaining } from './relative-age.js'
import { SettledThreadsModel } from './settled-threads.js'
import { usePreferences } from './sidebar-state.js'
import { threadDelayMs } from './thread-delays.js'

/**
 * Above a settled thread's composer: a "This thread is settled." notice, while the composer itself is blocked. The Host
 * refuses the model step a settled Session proposes, so the click that lifts the status has to be here rather than a
 * message that would end as `blocked`. It reads like the jj rebase notice beside it: one centred status card with the
 * settle age and the archive deadline, then the actions.
 *
 * It reads the sidebar's own preference source: the same Host settings when the Client has them, and the same browser
 * copy when a Host without the Settings namespace is serving the panel.
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
  const dated = settledAt !== undefined || archiveAt !== undefined
  // Both readings are relative ("3h", "in 22h"), so a long-open tab has to redraw them instead of freezing the age it
  // first rendered: one tick a minute is enough for either bucket.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!settled || !dated) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [dated, settled])
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
    <DockNotice
      label={t('threadSidebarSettledBanner')}
      icon={<CheckCircleIcon className="dshx:size-4 dshx:shrink-0" aria-hidden />}
      meta={
        <>
          {settledAt === undefined ? null : (
            <time dateTime={new Date(settledAt).toISOString()}>{t('threadSidebarSettledAt', { when: formatAge(settledAt, now) })}</time>
          )}
          {archiveAt === undefined ? null : (
            <time dateTime={new Date(archiveAt).toISOString()}>{t('threadSidebarSettledArchiveAt', { when: formatRemaining(archiveAt, now) })}</time>
          )}
        </>
      }
      actions={
        <>
          <Button size="sm" variant="ghost" disabled={archive.isPending} onClick={() => archive.mutate()}>
            <ArchiveIcon className="dshx:size-3.5" aria-hidden />
            {t('threadSidebarArchive')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              updatePreferences(
                SettledThreadsModel.unsettle({ settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }, [sessionId]),
              )
            }
          >
            {t('threadSidebarUnsettleToReply')}
          </Button>
        </>
      }
    />
  )
}
