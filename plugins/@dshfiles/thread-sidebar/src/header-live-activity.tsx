import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo } from 'react'
import { LiveActivityLine, useLiveTurns } from './live-activity.js'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { HostSnapshotsModel } from './snapshots.js'

type HeaderLiveActivityProps = Pick<PropsRuntime<'conversation.session.header.utilities'>, 'sessionId' | 'useSessions'> &
  Pick<PropsLocale<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>, 't'>

const NO_IDS: readonly string[] = []

/**
 * The thread header's working signal (polish pass b:r4et): while the thread runs, the synced spinner and the same live
 * activity line its row shows ("Running pnpm test · 1m 12s"). It reads the sidebar's shared live-turns query, so the
 * header adds no poll of its own, and it renders nothing while the thread is idle.
 *
 * b:czs9: it never shrinks below what it shows, so its elapsed time cannot spill onto the workspace chip beside it.
 * Instead it sheds parts by the header row's width (the row is an inline-size container): the elapsed time first,
 * then the step, leaving the spinner. The workspace chip sheds its label and count at narrower tiers.
 */
const HeaderLiveActivityBody = (props: HeaderLiveActivityProps): JSX.Element | null => {
  const sessionState = props.useSessions(HostSnapshotsModel.selectStableSessionListState)
  const session = sessionState.byId[props.sessionId]
  const running = session !== undefined && session.running && !session.blank
  const ids = useMemo(() => (running ? [props.sessionId] : NO_IDS), [props.sessionId, running])
  const turns = useLiveTurns(ids, sessionState.phase === 'ready')
  if (!running) return null
  const turn = turns.get(props.sessionId)
  return (
    <span
      className={cn(
        'dshx-root dshx:inline-flex dshx:max-w-64 dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:px-1 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:max-w-40',
        'dshx:@max-[36rem]:[&_[data-live-elapsed]]:hidden dshx:@max-[36rem]:[&_[data-live-elapsed-separator]]:hidden dshx:@max-[32rem]:[&_[data-live-step]]:hidden',
      )}
      data-testid="thread-header-live-activity"
      role="status"
    >
      <StatusGlyph label={props.t('threadSidebarWorking')} status="working" />
      <LiveActivityLine active startedAt={turn?.startedAt} step={turn?.step ?? props.t('threadSidebarWorking')} />
    </span>
  )
}

export const HeaderLiveActivity = (props: HeaderLiveActivityProps): JSX.Element => (
  <PluginQueryProvider>
    <HeaderLiveActivityBody {...props} />
  </PluginQueryProvider>
)

const TITLE_PREFIX = /^⟳ \d+ · /u

/**
 * The browser tab says how many threads work while you look elsewhere: "⟳ 2 · <title>". The Host page owns the title,
 * so this only adds or removes its own prefix, re-applying it when the page renames the tab.
 */
export const useWorkingTabTitle = (count: number, enabled: boolean): void => {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    const apply = (): void => {
      const base = document.title.replace(TITLE_PREFIX, '')
      const next = count > 0 ? `⟳ ${String(count)} · ${base}` : base
      if (document.title !== next) document.title = next
    }
    apply()
    const head = document.head
    const observer = new MutationObserver(apply)
    observer.observe(head, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
      const base = document.title.replace(TITLE_PREFIX, '')
      if (document.title !== base) document.title = base
    }
  }, [count, enabled])
}
