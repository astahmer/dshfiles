import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { LiveElapsed } from '@dshfiles/plugin-ui/components/live-elapsed'
import { RouteModel } from '@dshfiles/plugin-ui/components/model-mark'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArrowUpRightIcon, BotIcon, ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, useSyncExternalStore } from 'react'
import { ToolSteps } from '../tool-steps.js'
import { SubagentLivePreview, subagentStateLabel, type SubagentPreviewBindings } from './subagent-live-preview.js'
import { useSubagentRun } from './subagent-run.js'
import { useSubagentState } from './subagent-state.js'

type DockProps = Pick<PropsRuntime<'conversation.input.dock'>, 'useSessions' | 'useSessionStatus'>

const ID_SEPARATOR = '\n'
const ignoreTurnState = (): void => undefined
/** Up to this many working children show as rows; more fold into one "N subagents" row. */
const MAX_OPEN_ROWS = 3

/**
 * rich-composer's narrow phone bound (`LIVE_WORK_QUERY`): below it the composer folds every live row into one "Live
 * work" disclosure, so that is the fold, and this dock keeps its rows mounted (council round 22, item 5).
 */
const LIVE_WORK_QUERY = '(max-width: 27.99rem)'
const liveWorkQuery = (): MediaQueryList | undefined =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(LIVE_WORK_QUERY) : undefined
const subscribeLiveWork = (notify: () => void): (() => void) => {
  const list = liveWorkQuery()
  list?.addEventListener('change', notify)
  return () => list?.removeEventListener('change', notify)
}
const readLiveWork = (): boolean => liveWorkQuery()?.matches ?? false
const readLiveWorkOnServer = (): boolean => false

/**
 * One working child as one compact row, whatever it is doing: `glyph · name · [mark] model · current step · elapsed ·
 * Open`. The model is on the row itself (council round 17 B1.1), not only in the opened detail. The row never turns into
 * a card while a tool is in flight (the card/row flip of C2); opening it shows the live preview and Stop. With `runCards`
 * off (the `subagentRunCards` setting, "show the step and clock") the child is never held and the row shows its name and
 * model only.
 */
const DockRow = (
  props: DockProps & { readonly parentId: string; readonly childId: string; readonly preview: SubagentPreviewBindings; readonly runCards: boolean },
): JSX.Element => {
  const { parentId, childId, preview, runCards } = props
  const [open, setOpen] = useState(false)
  const label = props.useSessions(
    list =>
      list.projectionsBySession[SessionId(parentId)]?.values.subagentCatalog?.find(entry => entry.id === childId)?.label ??
      list.byId[SessionId(childId)]?.displayTitle ??
      childId,
  )
  const state = useSubagentState({ childId, useSessions: props.useSessions, useSessionStatus: props.useSessionStatus })
  const run = useSubagentRun({ childId, enabled: runCards, retainChild: preview.retainChild, useSessions: props.useSessions })
  const step = run.tool === undefined ? undefined : ToolSteps.ofName(run.tool)
  const waiting = step?.waitsForAnswer === true
  const stateLabel = waiting ? preview.t('subagentRunWaiting') : subagentStateLabel(preview.t, 'working')
  return (
    // A row never shrinks (round 21 D2): in the dock's max-h-72 column six rows squeezed to 31px over their 44px touch
    // row; whole rows overflow the column, which scrolls under its sticky fold row instead.
    <section
      aria-label={`${preview.t('subagentPreviewKind')}: ${label}`}
      className="dshx-root dshx:group/dock-row dshx:@container dshx:my-1 dshx:min-w-0 dshx:shrink-0 dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:text-xs"
      data-dshfiles-live-preview="agent"
      data-dshfiles-live-preview-seat="dock"
      data-state="working"
      data-waiting={waiting ? '' : undefined}
    >
      {/* Council round 22, item 1: on a narrow pane (a phone) one line gave the name ~60px ("Check cr…") beside the model
          and clock. There the row is two lines: line 1 the ring, the title over the whole width and ↗; line 2 at the
          title's x the mark, model and · elapsed. 54px tall, over the 44pt touch row. */}
      <div
        className="dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:pointer-coarse:h-11 dshx:@max-pane-narrow:h-auto dshx:@max-pane-narrow:min-h-[54px] dshx:@max-pane-narrow:items-stretch dshx:@max-pane-narrow:pointer-coarse:h-auto"
        data-subagent-dock-row=""
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={preview.t('subagentPreviewToggle', { label })}
          className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:pl-2 dshx:text-left dshx:hover:bg-accent dshx:@max-pane-narrow:grid dshx:@max-pane-narrow:h-auto dshx:@max-pane-narrow:grid-cols-[auto_minmax(0,1fr)] dshx:@max-pane-narrow:content-center dshx:@max-pane-narrow:gap-x-2 dshx:@max-pane-narrow:gap-y-0.5 dshx:@max-pane-narrow:py-2 dshx:@max-pane-narrow:pl-3"
          onClick={() => setOpen(value => !value)}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground dshx:@max-pane-narrow:hidden', open && 'dshx:rotate-90')}
          />
          <StatusGlyph label={stateLabel} status={waiting ? 'needs-you' : 'working'} />
          <span className="dshx:min-w-0 dshx:shrink dshx:truncate dshx:font-medium dshx:@max-pane-narrow:text-sm/5" data-subagent-dock-title="">
            {label}
          </span>
          {/* One line with the title on a wide pane (`contents`), its own line under the title on a narrow one. */}
          <span
            className="dshx:contents dshx:@max-pane-narrow:col-start-2 dshx:@max-pane-narrow:flex dshx:@max-pane-narrow:min-w-0 dshx:@max-pane-narrow:items-center dshx:@max-pane-narrow:gap-1 dshx:@max-pane-narrow:text-xs/4 dshx:@max-pane-narrow:text-muted-foreground"
            data-subagent-dock-meta=""
          >
            {step === undefined ? null : (
              <>
                {/* On line 2 the step follows the clock, so the clock never truncates. */}
                <span aria-hidden className="dshx:hidden dshx:@max-pane-narrow:order-last dshx:@max-pane-narrow:inline">
                  ·
                </span>
                <span
                  className={cn(
                    'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:@max-pane-narrow:order-last',
                    waiting ? 'dshx:text-foreground' : 'dshx:text-muted-foreground',
                  )}
                  data-subagent-run-step=""
                >
                  {waiting ? stateLabel : step.words}
                </span>
              </>
            )}
            {step === undefined ? <span className="dshx:flex-1 dshx:@max-pane-narrow:hidden" /> : null}
            {run.route === undefined ? null : (
              // Council round 22, item 10: on a wide pane the model is a fixed column after the name and its step, before
              // a fixed clock seat and the fixed action column, so every model name starts on one x (the empty mark seat
              // keeps a model without a family on it). It truncates its name; the mark stays.
              <RouteModel
                provider={run.route.provider}
                model={run.route.model}
                seat
                className="dshx:ml-1 dshx:w-36 dshx:shrink-0 dshx:@max-pane-narrow:ml-0 dshx:@max-pane-narrow:w-auto dshx:@max-pane-narrow:shrink"
              />
            )}
            {!runCards ? null : state.since === undefined ? (
              <span aria-hidden className="dshx:min-w-12 dshx:shrink-0 dshx:pr-1 dshx:@max-pane-narrow:hidden" data-subagent-dock-clock-seat="" />
            ) : (
              <>
                {run.route === undefined ? null : (
                  <span aria-hidden className="dshx:hidden dshx:@max-pane-narrow:inline" data-subagent-dock-separator="">
                    ·
                  </span>
                )}
                <LiveElapsed
                  active
                  className="dshx:min-w-12 dshx:shrink-0 dshx:pr-1 dshx:text-right dshx:text-muted-foreground dshx:@max-pane-narrow:min-w-0 dshx:@max-pane-narrow:text-left"
                  since={state.since}
                />
              </>
            )}
          </span>
        </button>
        {/* Council round 18 B1.2: one fixed action column across the dock (a job row's "Open in Processes ↗", 132px wide,
            takes the same 8.5rem, right-aligned), so every row's tabular clock ends on one edge. A narrow pane drops the
            label and the column. */}
        <Button
          size="xs"
          variant="ghost"
          className="dshx:mr-1 dshx:min-w-34 dshx:justify-end dshx:text-muted-foreground dshx:@max-pane-narrow:mr-0 dshx:@max-pane-narrow:h-auto dshx:@max-pane-narrow:min-w-11 dshx:@max-pane-narrow:items-start dshx:@max-pane-narrow:justify-center dshx:@max-pane-narrow:self-stretch dshx:@max-pane-narrow:rounded-none dshx:@max-pane-narrow:pt-3"
          data-live-work-action=""
          onClick={() => preview.openChild(childId)}
        >
          {/* Council round 22, item 13: the arrow alone at rest, the words when the row is hovered or holds keyboard focus;
              they are the button's name either way. They appear inside the fixed column, so nothing moves. A narrow pane
              keeps the arrow alone. */}
          <span className="dshx:sr-only dshx:@pane-narrow:group-hover/dock-row:not-sr-only dshx:@pane-narrow:group-has-[:focus-visible]/dock-row:not-sr-only">
            {preview.t('subagentPreviewOpenThread')}
          </span>
          <ArrowUpRightIcon aria-hidden="true" />
        </Button>
      </div>
      {open ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:border-border dshx:p-2">
          <SubagentLivePreview {...preview} childId={childId} state="working" onTurnState={ignoreTurnState} showOpenThread={false} />
        </div>
      ) : null}
    </section>
  )
}

/**
 * This thread's working subagents above the composer. A parent commonly ends its turn to wait for them, which folds the
 * delegation rows; this keeps each child in reach and clears as they go idle. Up to three children show as rows; four or
 * more fold into one sticky "N subagents" row, closed by default like background-jobs' dock; the reader's choice holds
 * while children start and finish. Both selectors read plain strings, so unrelated list and status updates do not
 * re-render it.
 */
export const SubagentPreviewDock = (
  props: DockProps & {
    readonly sessionId: string
    readonly preview: SubagentPreviewBindings
    readonly runCards: boolean
    /** The fold row's one phrase, "4 subagents working", from this plugin's table: never a count beside a word from another. */
    readonly foldLabel?: (count: number) => string
  },
): JSX.Element | null => {
  const parentId = SessionId(props.sessionId)
  const children = props.useSessions(list =>
    (list.projectionsBySession[parentId]?.values.subagentCatalog ?? [])
      .filter(entry => entry.mode !== 'external')
      .map(entry => entry.id)
      .join(ID_SEPARATOR),
  )
  const working = props.useSessionStatus(statuses =>
    (children === '' ? [] : children.split(ID_SEPARATOR)).filter(id => statuses.get(SessionId(id))?.running === true).join(ID_SEPARATOR),
  )
  // Four or more working children fold into one row (b:7rv2), the same row as background-jobs' dock; the reader's
  // choice holds while children start and finish, and resets with the thread (the dock is keyed by its session).
  const [expanded, setExpanded] = useState(false)
  const underLiveWork = useSyncExternalStore(subscribeLiveWork, readLiveWork, readLiveWorkOnServer)
  if (working === '') return null
  const list = working.split(ID_SEPARATOR)
  const folded = list.length > MAX_OPEN_ROWS
  return (
    <div
      aria-label={props.preview.t('subagentPreviewDock')}
      role="region"
      className="dshx-root dshx:mx-auto dshx:flex dshx:max-h-72 dshx:w-[calc(100%-var(--dsh-composer-side-clearance,0px)*2)] dshx:max-w-(--dsh-composer-card-max-width) dshx:flex-col dshx:overflow-y-auto"
      data-dshfiles-live-preview-dock="subagents"
    >
      {folded ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="dshx:sticky dshx:top-0 dshx:z-10 dshx:my-1 dshx:flex dshx:h-8 dshx:w-full dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:px-2 dshx:text-left dshx:text-xs dshx:hover:bg-accent dshx:pointer-coarse:h-11"
          data-dshfiles-live-preview-fold="subagents"
          onClick={() => setExpanded(value => !value)}
        >
          <ChevronRightIcon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground', expanded && 'dshx:rotate-90')} />
          <BotIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{props.foldLabel?.(list.length) ?? String(list.length)}</span>
          <StatusGlyph status="working" decorative />
        </button>
      ) : null}
      {/* Under the phone's Live work fold the rows stay mounted: the composer hides this fold row while Live work holds
          only subagents (one header, council round 22 item 5), and hides the rows behind it while it is closed. */}
      {!folded || expanded || underLiveWork ? list.map(childId => <DockRow key={childId} {...props} parentId={props.sessionId} childId={childId} />) : null}
    </div>
  )
}
