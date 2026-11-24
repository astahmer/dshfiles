import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { LiveElapsed } from '@dshfiles/plugin-ui/components/live-elapsed'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArrowUpRightIcon, BotIcon, ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
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
 * One working child as one compact row, whatever it is doing: `glyph · name · current step · elapsed · Open`. The row
 * never turns into a card while a tool is in flight (the card/row flip of C2); opening it shows the live preview, the
 * model and Stop. With `runCards` off (the `subagentRunCards` setting, "show the step and clock") the child is never
 * held and the row shows its name only.
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
    <section
      aria-label={`${preview.t('subagentPreviewKind')}: ${label}`}
      className="dshx-root dshx:@container dshx:my-1 dshx:min-w-0 dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:text-xs"
      data-dshfiles-live-preview="agent"
      data-dshfiles-live-preview-seat="dock"
      data-state="working"
      data-waiting={waiting ? '' : undefined}
    >
      <div className="dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:pointer-coarse:h-11" data-subagent-dock-row="">
        <button
          type="button"
          aria-expanded={open}
          aria-label={preview.t('subagentPreviewToggle', { label })}
          className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:pl-2 dshx:text-left dshx:hover:bg-accent"
          onClick={() => setOpen(value => !value)}
        >
          <ChevronRightIcon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground', open && 'dshx:rotate-90')} />
          <StatusGlyph label={stateLabel} status={waiting ? 'needs-you' : 'working'} />
          <span className="dshx:min-w-0 dshx:shrink dshx:truncate dshx:font-medium">{label}</span>
          {step === undefined ? null : (
            <span
              className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', waiting ? 'dshx:text-foreground' : 'dshx:text-muted-foreground')}
              data-subagent-run-step=""
            >
              {waiting ? stateLabel : step.words}
            </span>
          )}
          <span className="dshx:flex-1" />
          {!runCards || state.since === undefined ? null : (
            <LiveElapsed active className="dshx:shrink-0 dshx:pr-1 dshx:text-muted-foreground" since={state.since} />
          )}
        </button>
        <Button
          size="xs"
          variant="ghost"
          className="dshx:mr-1 dshx:shrink dshx:text-muted-foreground"
          onClick={() => preview.openChild(childId)}
        >
          <span className="dshx:@max-pane-narrow:sr-only">{preview.t('subagentPreviewOpenThread')}</span>
          <ArrowUpRightIcon aria-hidden="true" />
        </Button>
      </div>
      {open ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:border-border dshx:p-2">
          {run.model === undefined ? null : (
            <p className="dshx:text-muted-foreground" data-subagent-run-model="">
              {run.model}
            </p>
          )}
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
    readonly count?: (count: number) => string
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
  if (working === '') return null
  const list = working.split(ID_SEPARATOR)
  const folded = list.length > MAX_OPEN_ROWS
  const count = props.count?.(list.length) ?? String(list.length)
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
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{`${count} ${subagentStateLabel(props.preview.t, 'working').toLocaleLowerCase()}`}</span>
          <StatusGlyph status="working" decorative />
        </button>
      ) : null}
      {!folded || expanded ? list.map(childId => <DockRow key={childId} {...props} parentId={props.sessionId} childId={childId} />) : null}
    </div>
  )
}
