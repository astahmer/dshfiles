import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { CheckCircleIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect } from 'react'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { usePreferences } from './sidebar-state.js'

/**
 * Above a settled thread's composer: an "Unsettle to reply" banner, while the composer itself is
 * blocked. The Host refuses the model step a settled Session proposes, so the click that lifts the
 * status has to be here rather than a message that would end as `blocked`.
 *
 * It reads the sidebar's own preference source: the same Host settings when the Client has them, and
 * the same browser copy when a Host without the Settings namespace is serving the panel.
 */
export const SettledThreadDock = (props: {
  readonly sessionId: SessionSummary['id']
  readonly blocks: ComposerBlocks
  readonly t: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
}): JSX.Element | null => {
  const { sessionId, blocks, t } = props
  const { preferences, updatePreferences } = usePreferences()
  const settled = preferences.settledSessionIds.includes(sessionId)
  const composerReason = t('threadSidebarSettledComposer')
  useEffect(() => {
    if (!settled) return
    blocks.set(sessionId, { reason: composerReason })
    return () => blocks.set(sessionId, undefined)
  }, [blocks, composerReason, sessionId, settled])
  if (!settled) return null
  return (
    <div
      role="status"
      aria-label={t('threadSidebarSettledBanner')}
      className="dshx-root dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted dshx:px-3 dshx:py-1.5 dshx:text-sm dshx:text-muted-foreground"
    >
      <CheckCircleIcon className="dshx:size-4 dshx:shrink-0" aria-hidden />
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{t('threadSidebarSettledBanner')}</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => updatePreferences({ settledSessionIds: preferences.settledSessionIds.filter(candidate => candidate !== sessionId) })}
      >
        {t('threadSidebarUnsettleToReply')}
      </Button>
    </div>
  )
}
