import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useApi, useApiEvent, defineClient } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { AlarmClockIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { goalAutoRetryApi, type ArmingView, type RetryStatusView } from './api.js'

const NS = 'goal-auto-retry'

const chipCopy = {
  label: 'Auto-retry goal after a usage limit',
  off: 'Off — a refused round leaves the goal paused',
  on: 'Armed — a refused round resumes the goal',
}

const waitLabel = (retry: RetryStatusView): string => {
  if (retry.kind === 'idle') return ''
  const at = new Date(retry.retry.at)
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/**
 * The composer chip: one thread's arming, and the wait it will use.
 *
 * The chip writes the same arming the Host reads, so flipping it in one tab is
 * what the Host obeys. A pending attempt from an earlier tab shows on mount
 * because the Host, not the browser, owns the timer.
 */
const GoalAutoRetryChip = (props: PropsRuntime<'conversation.input.right'>): ReactNode => {
  const client = useApi(goalAutoRetryApi)
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['goal-auto-retry', props.sessionId],
    queryFn: ({ signal }) => client.status({ sessionId: props.sessionId }, { signal }),
    staleTime: 5_000,
  })
  useApiEvent(goalAutoRetryApi, 'changed', () => {
    void queryClient.invalidateQueries({ queryKey: ['goal-auto-retry', props.sessionId] })
  })
  const [delayDraft, setDelayDraft] = useState<string | undefined>(undefined)
  const status = query.data
  if (status === undefined) return null
  const arming = status.arming
  const armed = arming.enabled || status.kind !== 'idle'
  const write = (next: ArmingView): void => {
    void client.arm({ sessionId: props.sessionId, enabled: next.enabled, delayMinutes: next.delayMinutes }).then(
      updated => queryClient.setQueryData(['goal-auto-retry', props.sessionId], updated),
      () => void queryClient.invalidateQueries({ queryKey: ['goal-auto-retry', props.sessionId] }),
    )
  }
  const delayValue = delayDraft ?? (arming.delayMinutes > 0 ? String(arming.delayMinutes) : '')
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        setDelayDraft(undefined)
      }}
    >
      <TooltipProvider delayDuration={500}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={chipCopy.label}
                aria-pressed={armed}
                data-armed={armed ? 'true' : 'false'}
                className={cn(
                  'dshx-root dshx:text-muted-foreground dshx:hover:text-foreground',
                  armed && 'dshx:text-foreground',
                  status.kind === 'scheduled' && 'dshx:animate-pulse',
                )}
                onMouseDown={event => event.preventDefault()}
              >
                <AlarmClockIcon />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            {armed ? `${chipCopy.on}${status.kind === 'scheduled' ? ` — resumes at ${waitLabel(status)}` : ''}` : chipCopy.off}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent side="top" align="end" className="dshx-root dshx:w-80 dshx:space-y-3">
        <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-3">
          <div className="dshx:space-y-1">
            <Label htmlFor={`${NS}-toggle`}>{chipCopy.label}</Label>
            <p className="dshx:text-xs dshx:text-muted-foreground">
              Only quota, rate-limit and account refusals. The goal resumes on the Host, so closing the tab keeps it.
            </p>
          </div>
          <Switch id={`${NS}-toggle`} checked={arming.enabled} onCheckedChange={enabled => write({ ...arming, enabled })} />
        </div>
        <div className="dshx:space-y-1">
          <Label htmlFor={`${NS}-delay`}>Retry after (minutes)</Label>
          <Input
            id={`${NS}-delay`}
            inputMode="numeric"
            placeholder="Provider reset + 3 min"
            value={delayValue}
            onChange={event => setDelayDraft(event.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => {
              const minutes = delayDraft === undefined || delayDraft === '' ? 0 : Math.min(1440, Number(delayDraft))
              if (Number.isFinite(minutes)) write({ ...arming, delayMinutes: minutes })
              setDelayDraft(undefined)
            }}
          />
          <p className="dshx:text-xs dshx:text-muted-foreground">Leave empty to follow the reset the provider announces, plus a margin.</p>
        </div>
        {status.kind === 'scheduled' ? (
          <p className="dshx:text-xs">
            Resumes at {waitLabel(status)} (attempt {status.retry.attempt}).
          </p>
        ) : null}
        {status.kind === 'failed' ? (
          <p className="dshx:text-xs dshx:text-destructive">Not resumed: {status.reason}. Resume the goal yourself to try again.</p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

export default defineClient({
  name: '@dshfiles/goal-auto-retry',
  inject: ['slots', 'sessions'],
  setup(ctx, decorate) {
    ctx.slots.inject('conversation.input.right', () =>
      ctx.slots.register({ name: 'conversation.input.right', id: 'goal-auto-retry', order: 88 }, decorate(GoalAutoRetryChip)),
    )
  },
})
