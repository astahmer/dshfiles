import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { BotIcon, ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
import { SubagentLivePreview, subagentStateLabel, type SubagentPreviewBindings } from './subagent-live-preview.js'

type DockProps = Pick<PropsRuntime<'conversation.input.dock'>, 'useSessions' | 'useSessionStatus'>

const ID_SEPARATOR = '\n'
const ignoreTurnState = (): void => undefined

const DockRow = (props: DockProps & { readonly parentId: string; readonly childId: string; readonly preview: SubagentPreviewBindings }): JSX.Element => {
  const { parentId, childId, preview } = props
  const [open, setOpen] = useState(false)
  const label = props.useSessions(
    list =>
      list.projectionsBySession[SessionId(parentId)]?.values.subagentCatalog?.find(entry => entry.id === childId)?.label ??
      list.byId[SessionId(childId)]?.displayTitle ??
      childId,
  )
  const state = subagentStateLabel(preview.t, 'working')
  return (
    <section
      aria-label={`${preview.t('subagentPreviewKind')}: ${label}`}
      className="dshx-root dshx:@container dshx:my-1 dshx:overflow-hidden dshx:rounded-lg dshx:bg-background dshx:border dshx:border-border dshx:text-xs"
      data-dshfiles-live-preview="agent"
      data-dshfiles-live-preview-seat="dock"
      data-state="working"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={preview.t('subagentPreviewToggle', { label })}
        className="dshx:flex dshx:h-8 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:px-2 dshx:text-left dshx:hover:bg-accent"
        onClick={() => setOpen(value => !value)}
      >
        <ChevronRightIcon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground', open && 'dshx:rotate-90')} />
        <BotIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
        <span className="dshx:shrink-0 dshx:text-muted-foreground dshx:@max-pane-narrow:sr-only">{preview.t('subagentPreviewKind')}</span>
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{label}</span>
        <span role="status" className="dshx:shrink-0">
          <Badge variant="secondary">{state}</Badge>
        </span>
      </button>
      {open ? (
        <div className="dshx:border-t dshx:border-border dshx:p-2">
          <SubagentLivePreview {...preview} childId={childId} state="working" onTurnState={ignoreTurnState} />
        </div>
      ) : null}
    </section>
  )
}

/**
 * This thread's working subagents above the composer. A parent commonly ends its turn to wait for them, which folds the
 * delegation rows; this keeps each child in reach and clears as they go idle. Both selectors read plain strings, so
 * unrelated list and status updates do not re-render it.
 */
export const SubagentPreviewDock = (props: DockProps & { readonly sessionId: string; readonly preview: SubagentPreviewBindings }): JSX.Element | null => {
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
  if (working === '') return null
  return (
    <div
      aria-label={props.preview.t('subagentPreviewDock')}
      role="region"
      className="dshx-root dshx:mx-auto dshx:flex dshx:max-h-72 dshx:w-[calc(100%-var(--dsh-composer-side-clearance,0px)*2)] dshx:max-w-(--dsh-composer-card-max-width) dshx:flex-col dshx:overflow-y-auto"
      data-dshfiles-live-preview-dock="subagents"
    >
      {working.split(ID_SEPARATOR).map(childId => (
        <DockRow key={childId} {...props} parentId={props.sessionId} childId={childId} />
      ))}
    </div>
  )
}
