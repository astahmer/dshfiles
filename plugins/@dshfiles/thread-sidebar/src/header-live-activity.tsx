import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo } from 'react'
import { LiveElapsed } from '@dshfiles/plugin-ui/components/live-elapsed'
import { LiveActivityLine, useLiveTurns, type LiveTurnView } from './live-activity.js'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { HostSnapshotsModel } from './snapshots.js'

type HeaderLiveActivityProps = Pick<PropsRuntime<'conversation.session.header.utilities'>, 'sessionId' | 'useSessions' | 'useSessionStatus'> &
  Pick<PropsLocale<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>, 't'>

const NO_IDS: readonly string[] = []

/**
 * The thread header's working signal (polish pass b:r4et): while the thread runs, the synced spinner and the same live
 * activity line its row shows ("Running pnpm test · 1m 12s"). It reads the sidebar's shared live-turns query, so the
 * header adds no poll of its own, and it renders nothing while the thread is idle.
 *
 * b:czs9: it never shrinks below what it shows, so its elapsed time cannot spill onto the workspace chip beside it.
 * Instead it sheds parts by the header row's width (the row is an inline-size container): the elapsed time first,
 * then the step, leaving the glyph. The workspace chip sheds its label and count at narrower tiers.
 *
 * A turn that waits for the user is not Working (unslop H8): it shows the Needs-you glyph and label, and the glyph is
 * what stays in a narrow pane, so a blocked thread never reads as a busy one. That holds for a question (the turn's
 * open call says so) and for an approval or any other pending interaction (the thread's own status says so).
 */
export const HeaderLiveSignal = (props: {
  readonly turn: LiveTurnView | undefined
  /** The thread holds a pending interaction (an approval, a plan review, a question): nothing runs until the user acts. */
  readonly waitingOnYou?: boolean
  readonly labels: { readonly working: string; readonly needsYou: string }
}): JSX.Element => {
  const needsYou = props.turn?.needsYou === true || props.waitingOnYou === true
  return (
    <span
      className={cn(
        'dshx-root dshx:inline-flex dshx:max-w-64 dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:px-1 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:max-w-40',
        'dshx:@max-[36rem]:[&_[data-live-elapsed]]:hidden dshx:@max-[36rem]:[&_[data-live-elapsed-separator]]:hidden dshx:@max-[32rem]:[&_[data-live-step]]:hidden',
      )}
      data-testid="thread-header-live-activity"
      data-needs-you={needsYou ? '' : undefined}
    >
      {/* A screen reader hears the status word when it changes, once: never the step or the clock beside it (D14). */}
      <span className="dshx:sr-only" aria-live="polite" data-header-status-announcer="">
        {needsYou ? props.labels.needsYou : props.labels.working}
      </span>
      <StatusGlyph label={needsYou ? props.labels.needsYou : props.labels.working} status={needsYou ? 'needs-you' : 'working'} />
      {needsYou ? (
        // No shimmer: nothing progresses until the user answers. The clock says how long it has waited.
        <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:text-foreground">
          <span className="dshx:min-w-0 dshx:truncate" data-live-step="">
            {props.labels.needsYou}
          </span>
          {props.turn?.startedAt === undefined ? null : (
            <>
              <span aria-hidden="true" data-live-elapsed-separator="">
                ·
              </span>
              <LiveElapsed active className="dshx:shrink-0 dshx:text-muted-foreground" since={props.turn.startedAt} />
            </>
          )}
        </span>
      ) : (
        <LiveActivityLine active startedAt={props.turn?.startedAt} step={props.turn?.step ?? props.labels.working} />
      )}
    </span>
  )
}

/**
 * The live line's seat: a fixed width whether the thread works or not, so the step growing ("Running for i in … · 3s")
 * or the line coming and going never moves the workspace chip and the actions beside it (F12, 157 px measured). It
 * narrows with the header row at the same tiers the line sheds its clock and step, down to the glyph alone. The line
 * fades in over 120 ms (DESIGN.md › Motion).
 */
export const HeaderLiveSlot = (props: { readonly children?: JSX.Element | null }): JSX.Element => (
  <span
    className="dshx-root dshx:inline-flex dshx:w-64 dshx:shrink-0 dshx:items-center dshx:overflow-hidden dshx:@max-pane-compact:w-40 dshx:@max-[32rem]:w-6 dshx:[&>*]:transition-opacity dshx:[&>*]:duration-(--dshx-duration-fade) dshx:[&>*]:starting:opacity-0"
    data-header-live-slot=""
  >
    {props.children}
  </span>
)

const HeaderLiveActivityBody = (props: HeaderLiveActivityProps): JSX.Element | null => {
  const sessionState = props.useSessions(HostSnapshotsModel.selectStableSessionListState)
  const session = sessionState.byId[props.sessionId]
  const running = session !== undefined && session.running && !session.blank
  const ids = useMemo(() => (running ? [props.sessionId] : NO_IDS), [props.sessionId, running])
  const turns = useLiveTurns(ids, sessionState.phase === 'ready')
  // An approval is not a tool call the live-turn fold can see: the thread's pending interaction is the signal.
  const waitingOnYou = props.useSessionStatus(statuses => statuses.get(props.sessionId)?.pendingInteraction !== undefined)
  // A parent whose own turn ended is still Working while a subagent works (DESIGN.md R2), but the header's subagent
  // chip ("1 subagent", with the working glyph) already says so: the seat stays empty instead of repeating it as
  // "Waiting on 1 subagent" (round five B4). The seat keeps its width, so nothing beside it moves.
  if (!running) return null
  return (
    <HeaderLiveSignal
      turn={turns.get(props.sessionId)}
      waitingOnYou={waitingOnYou}
      labels={{ working: props.t('threadSidebarWorking'), needsYou: props.t('threadSidebarStateNeedsYou') }}
    />
  )
}

export const HeaderLiveActivity = (props: HeaderLiveActivityProps): JSX.Element | null => {
  // A subagent says its state on its title line, right after its model (council round 22, item 7: the seat floated it
  // mid-bar). Its header has no seat to hold steady, so nothing renders here.
  const child = props.useSessions(state => state.byId[props.sessionId]?.origin === 'subagent')
  if (child) return null
  return (
    <PluginQueryProvider>
      <HeaderLiveSlot>
        <HeaderLiveActivityBody {...props} />
      </HeaderLiveSlot>
    </PluginQueryProvider>
  )
}

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
