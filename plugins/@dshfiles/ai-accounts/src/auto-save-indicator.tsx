import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CheckIcon, CircleAlertIcon, RotateCcwIcon } from '@dshfiles/plugin-ui/icons'
import type { AutoSaveStatus } from './auto-save.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

/** A quiet status line for auto-saved edits; only a failure asks for attention. */
export const AutoSaveIndicator = (props: {
  readonly status: AutoSaveStatus
  readonly dirty: boolean
  readonly problem: string | null
  readonly renamePending: boolean
  readonly onRetry: () => void
}): JSX.Element => {
  const base = 'dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs'
  if (props.status.kind === 'error') {
    return (
      <TooltipProvider delayDuration={500}>
        <span className={`${base} dshx:text-destructive`} role="alert">
          <CircleAlertIcon className="dshx:size-3.5 dshx:shrink-0" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="dshx:truncate">Couldn&apos;t save: {props.status.message}</span>
            </TooltipTrigger>
            <TooltipContent>{props.status.message}</TooltipContent>
          </Tooltip>
          <Button className="dshx:shrink-0" onClick={props.onRetry} size="xs" type="button" variant="outline">
            <RotateCcwIcon />
            Retry
          </Button>
        </span>
      </TooltipProvider>
    )
  }
  if (props.dirty && props.problem !== null) {
    return (
      <span className={`${base} dshx:text-warning`} role="status">
        <CircleAlertIcon className="dshx:size-3.5 dshx:shrink-0" />
        <span className="dshx:truncate">Not saved: {props.problem}</span>
      </span>
    )
  }
  if (props.renamePending) {
    return (
      <span className={`${base} dshx:text-muted-foreground`} role="status">
        The new route slug saves when you leave the field.
      </span>
    )
  }
  if (props.status.kind === 'saving') {
    return (
      <span className={`${base} dshx:text-muted-foreground`} role="status">
        <Spinner className="dshx:size-3.5" />
        Saving…
      </span>
    )
  }
  if (props.status.kind === 'pending' || props.dirty) {
    return (
      <span className={`${base} dshx:text-muted-foreground`} role="status">
        <StatusDot size="sm" tone="warning" />
        Unsaved changes…
      </span>
    )
  }
  return (
    <span className={`${base} dshx:text-muted-foreground`} role="status">
      <CheckIcon className="dshx:size-3.5 dshx:text-success" />
      {props.status.kind === 'saved' ? 'Saved' : 'Changes save automatically'}
    </span>
  )
}
