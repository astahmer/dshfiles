import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentRunStatusLabels } from '@dshfiles/plugin-ui/components/motion/agent-run-status'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { BotIcon, ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
import { SubagentLivePreview, subagentStateLabel, type SubagentPreviewBindings, type SubagentPreviewTranslate } from './subagent-live-preview.js'
import { SubagentRunCard, subagentRunStepLabel, useSubagentRun } from './subagent-run-card.js'
import { useSubagentStop } from './subagent-stop.js'

type DockProps = Pick<PropsRuntime<'conversation.input.dock'>, 'useSessions' | 'useSessionStatus'>

const ID_SEPARATOR = '\n'
const ignoreTurnState = (): void => undefined

/** The card's fixed labels come from the same namespace as the row it replaces. */
const runLabels = (input: { readonly t: SubagentPreviewTranslate; readonly armed: boolean }): Partial<AgentRunStatusLabels> => ({
  running: input.t('subagentPreviewWorking'),
  done: input.t('subagentPreviewFinished'),
  stopped: input.t('subagentPreviewInterrupted'),
  failed: input.t('subagentPreviewFailedToStart'),
  step: input.t('subagentRunStep'),
  elapsed: input.t('subagentRunElapsed'),
  stop: input.t(input.armed ? 'subagentPreviewConfirmStop' : 'subagentPreviewStop'),
})

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
  const state = subagentStateLabel(preview.t, 'working')
  const run = useSubagentRun({ childId, enabled: runCards, retainChild: preview.retainChild, useSessions: props.useSessions })
  const { stop, armed, requestStop, cancel } = useSubagentStop({ binding: run?.binding, t: preview.t })
  const toggle = (): void => setOpen(value => !value)
  return (
    <section
      aria-label={`${preview.t('subagentPreviewKind')}: ${label}`}
      className={cn(
        'dshx-root dshx:@container dshx:my-1 dshx:min-w-0 dshx:overflow-hidden dshx:rounded-lg dshx:text-xs',
        run === undefined && 'dshx:bg-background dshx:border dshx:border-border',
      )}
      data-dshfiles-live-preview="agent"
      data-dshfiles-live-preview-seat="dock"
      data-state="working"
    >
      {run === undefined ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={preview.t('subagentPreviewToggle', { label })}
          className="dshx:flex dshx:h-8 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:px-2 dshx:text-left dshx:hover:bg-accent"
          onClick={toggle}
        >
          <ChevronRightIcon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground', open && 'dshx:rotate-90')} />
          <BotIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
          <span className="dshx:shrink-0 dshx:text-muted-foreground dshx:@max-pane-narrow:sr-only">{preview.t('subagentPreviewKind')}</span>
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{label}</span>
          <span role="status" className="dshx:shrink-0">
            <Badge variant="secondary">{state}</Badge>
          </span>
        </button>
      ) : (
        <>
          <SubagentRunCard
            run={run}
            heading={label}
            stepLabel={subagentRunStepLabel({ t: preview.t, tool: run.tool })}
            openLabel={preview.t('subagentPreviewOpenThread')}
            labels={runLabels({ t: preview.t, armed })}
            onStop={requestStop}
            onOpen={() => preview.openChild(childId)}
          />
          <div className="dshx:flex dshx:items-center dshx:gap-1">
            {armed ? (
              <Button size="xs" variant="ghost" className="dshx:shrink" onClick={cancel}>
                {preview.t('subagentPreviewKeepWorking')}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={open}
              aria-label={preview.t('subagentPreviewToggle', { label })}
              className="dshx:ml-auto dshx:shrink dshx:text-muted-foreground"
              onClick={toggle}
            >
              <ChevronRightIcon aria-hidden className={cn('dshx:size-3.5', open && 'dshx:rotate-90')} />
              <span className="dshx:@max-pane-narrow:sr-only">{preview.t('subagentRunDetails')}</span>
            </Button>
          </div>
        </>
      )}
      {stop.kind === 'failed' ? (
        <p className="dshx:mx-2 dshx:my-1 dshx:text-destructive">{preview.t('subagentPreviewStopFailed', { error: stop.message })}</p>
      ) : null}
      {open ? (
        <div className="dshx:border-t dshx:border-border dshx:p-2">
          <SubagentLivePreview {...preview} childId={childId} state="working" onTurnState={ignoreTurnState} showActions={run === undefined} />
        </div>
      ) : null}
    </section>
  )
}

/**
 * This thread's working subagents above the composer. A parent commonly ends its turn to wait for them, which folds the
 * delegation rows; this keeps each child in reach and clears as they go idle. Two or more rows get a group header that
 * collapses them all; the choice holds while children start and finish. Both selectors read plain strings, so
 * unrelated list and status updates do not re-render it.
 *
 * A working child with a known open turn, route and tool becomes the compact run card; every missing part keeps the
 * one-line row, so the card never invents a step, a model or a clock.
 */
export const SubagentPreviewDock = (
  props: DockProps & { readonly sessionId: string; readonly preview: SubagentPreviewBindings; readonly runCards: boolean },
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
  const [collapsed, setCollapsed] = useState(false)
  if (working === '') return null
  const workingIds = working.split(ID_SEPARATOR)
  const grouped = workingIds.length > 1
  return (
    <div
      aria-label={props.preview.t('subagentPreviewDock')}
      role="region"
      className="dshx-root dshx:mx-auto dshx:flex dshx:max-h-72 dshx:w-[calc(100%-var(--dsh-composer-side-clearance,0px)*2)] dshx:max-w-(--dsh-composer-card-max-width) dshx:flex-col dshx:overflow-y-auto"
      data-dshfiles-live-preview-dock="subagents"
    >
      {grouped ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={props.preview.t('subagentPreviewDockToggle')}
          className="dshx:sticky dshx:top-0 dshx:z-10 dshx:my-1 dshx:flex dshx:h-8 dshx:w-full dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:px-2 dshx:text-left dshx:text-xs dshx:hover:bg-accent"
          data-dshfiles-live-preview-dock-header=""
          onClick={() => setCollapsed(value => !value)}
        >
          <ChevronRightIcon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground', !collapsed && 'dshx:rotate-90')} />
          <BotIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{props.preview.t('subagentPreviewDock')}</span>
          <Badge variant="secondary">{workingIds.length}</Badge>
        </button>
      ) : null}
      {grouped && collapsed ? null : workingIds.map(childId => <DockRow key={childId} {...props} parentId={props.sessionId} childId={childId} />)}
    </div>
  )
}
